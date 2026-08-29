import type { SiteSelectors } from "../src/modules/config";
import type { ToolResultDeliveryBatch } from "../src/modules/tool_result";

const PNG_BASE64 = "iVBORw0KGgo=";
let activeActions: string[] | null = null;

async function main(): Promise<void> {
  installBrowserGlobals();
  const { deliverResult } = await import("../src/modules/result_delivery");
  await runTest("pastes before waiting and writing acknowledged results", async () => {
    const page = installFakePage(true);
    const delivery = await deliverResult(createBatch(), SELECTORS);

    assertEqual(page.actions[0], "paste", "attachment was not pasted first");
    assertEqual(page.actions[1], "wait:2000", "attachment settle wait changed");
    assertEqual(page.actions[2], "write", "result text was written before the attachment wait");
    assert(page.input.innerText.includes('"status": "success"'), "acknowledged attachment became an error");
    assert(delivery.delivered, "acknowledged result was not delivered");
  });
  await runTest("reports an unacknowledged paste for only its attachment result", async () => {
    const page = installFakePage(false);
    const delivery = await deliverResult(createBatch(), SELECTORS);

    assertEqual(page.actions[0], "paste", "attachment was not pasted first");
    assertEqual(page.actions[1], "wait:2000", "unacknowledged paste skipped the settle wait");
    assertEqual(page.actions[2], "write", "failure text was written before the attachment wait");
    assert(page.input.innerText.includes('"request_id": "attachment-id"'), "attachment request ID was lost");
    assert(page.input.innerText.includes('"status": "error"'), "unacknowledged paste was not reported");
    assert(page.input.innerText.includes("did not acknowledge"), "paste failure reason was not included");
    assert(page.input.innerText.includes('"request_id": "text-id"'), "unrelated result was lost");
    assert(page.input.innerText.includes('"output": "text result"'), "unrelated result was changed");
    assert(delivery.delivered, "attachment failure text did not remain sendable");
  });
  await runTest("acknowledges each attachment group independently", async () => {
    const page = installFakePage([true, false]);
    const delivery = await deliverResult(createMultiAttachmentBatch(), SELECTORS);

    assertEqual(page.actions[0], "paste", "first attachment group was not pasted");
    assertEqual(page.actions[1], "wait:2000", "first attachment group did not settle independently");
    assertEqual(page.actions[2], "paste", "second attachment group was flattened into the first paste");
    assertEqual(page.actions[3], "wait:2000", "second attachment group did not settle independently");
    assertEqual(page.actions[4], "write", "partial attachment results were not written after both pastes");
    assertEqual(page.pastedFileNames[0]?.join(","), "first.png", "first paste contained another group");
    assertEqual(page.pastedFileNames[1]?.join(","), "second.png", "second paste contained another group");

    const results = parseInputResults(page.input.innerText);
    assertEqual(results.get("first-id")?.status, "success", "acknowledged group became an error");
    assertEqual(results.get("second-id")?.status, "error", "unacknowledged group remained successful");
    assert(delivery.delivered, "partial attachment results were not sendable");
  });
}

const SELECTORS: SiteSelectors = {
  codeBlocks: "pre code",
  inputArea: "#input",
  messageBlocks: ".message",
  sendButton: "button.send",
  stopButton: "button.stop",
};

function createBatch(): ToolResultDeliveryBatch {
  const outputParts = [
    formatResult("attachment-id", "attachment prepared"),
    formatResult("text-id", "text result"),
  ];
  return {
    attachmentGroups: [{
      attachments: [{
        data: PNG_BASE64,
        mimeType: "image/png",
        name: "sample.png",
        size: 8,
      }],
      outputIndex: 0,
      requestId: "attachment-id",
      toolName: "attach_file",
    }],
    output: outputParts.join("\n\n"),
    outputParts,
  };
}

function createMultiAttachmentBatch(): ToolResultDeliveryBatch {
  const outputParts = [
    formatResult("first-id", "first attachment prepared"),
    formatResult("second-id", "second attachment prepared"),
  ];
  return {
    attachmentGroups: [
      createAttachmentGroup("first-id", "first.png", 0),
      createAttachmentGroup("second-id", "second.png", 1),
    ],
    output: outputParts.join("\n\n"),
    outputParts,
  };
}

function createAttachmentGroup(requestId: string, name: string, outputIndex: number) {
  return {
    attachments: [{
      data: PNG_BASE64,
      mimeType: "image/png",
      name,
      size: 8,
    }],
    outputIndex,
    requestId,
    toolName: "attach_file",
  };
}

function formatResult(requestId: string, output: string): string {
  return `\`\`\`json\n${JSON.stringify({
    mcp_action: "result",
    request_id: requestId,
    status: "success",
    output,
  }, null, 2)}\n\`\`\``;
}

interface FakePage {
  actions: string[];
  input: { innerText: string };
  pastedFileNames: string[][];
}

function installFakePage(acknowledgePaste: boolean | readonly boolean[]): FakePage {
  const actions: string[] = [];
  const pastedFileNames: string[][] = [];
  let pasteIndex = 0;
  activeActions = actions;
  let innerText = "";
  const input = {
    contains: () => false,
    dispatchEvent: (event: Event) => {
      if (event.type === "paste") {
        actions.push("paste");
        const clipboardData = (event as ClipboardEvent).clipboardData;
        pastedFileNames.push(Array.from(clipboardData?.files ?? []).map((file) => file.name));
        const acknowledged = typeof acknowledgePaste === "boolean"
          ? acknowledgePaste
          : acknowledgePaste[pasteIndex] ?? false;
        pasteIndex++;
        if (acknowledged) {event.preventDefault();}
      }
      return !event.defaultPrevented;
    },
    focus: () => undefined,
    get innerText() {
      return innerText;
    },
    set innerText(value: string) {
      actions.push("write");
      innerText = value;
    },
    textContent: "",
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      activeElement: input,
      execCommand: () => false,
      querySelectorAll: () => [input],
    },
  });

  return { actions, input, pastedFileNames };
}

function parseInputResults(value: string): Map<string, Record<string, unknown>> {
  const results = new Map<string, Record<string, unknown>>();
  for (const match of value.matchAll(/```json\n([\s\S]*?)\n```/g)) {
    const result = JSON.parse(match[1] ?? "{}") as Record<string, unknown>;
    if (typeof result.request_id === "string") {
      results.set(result.request_id, result);
    }
  }
  return results;
}

function installBrowserGlobals(): void {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US" },
    });
  }
  class FakeDataTransfer {
    public readonly files: File[] = [];
    public readonly items = {
      add: (file: File) => this.files.push(file),
    };
  }
  class FakeClipboardEvent extends Event {
    public readonly clipboardData: FakeDataTransfer;

    public constructor(type: string, init: EventInit & { clipboardData: FakeDataTransfer }) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }
  class FakeInputElement {}

  Object.defineProperty(globalThis, "DataTransfer", { configurable: true, value: FakeDataTransfer });
  Object.defineProperty(globalThis, "ClipboardEvent", { configurable: true, value: FakeClipboardEvent });
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: FakeInputElement });
  Object.defineProperty(globalThis, "HTMLTextAreaElement", { configurable: true, value: FakeInputElement });
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: (handler: () => void, delayMs: number) => {
      activeActions?.push(`wait:${delayMs}`);
      handler();
      return 0;
    },
  });
}

async function runTest(name: string, test: () => void | Promise<void>): Promise<void> {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

void main();
