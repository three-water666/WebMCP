import type { SiteSelectors } from "../src/modules/config";

export {};

interface FakeFocusable {
  focus: () => void;
  shadowRoot?: { activeElement: FakeFocusable | null };
}

class FakeInput implements FakeFocusable {
  public innerText = "";

  public contains(): boolean {
    return false;
  }

  public dispatchEvent(event: Event): boolean {
    if (event.type === "keydown" && (event as KeyboardEvent).key === "Enter") {
      this.innerText = "";
    }
    return true;
  }

  public focus(): void {
    fakeDocument.activeElement = this;
  }

  public getBoundingClientRect(): DOMRect {
    return {
      bottom: 40,
      height: 40,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }
}

const input = new FakeInput();
const fakeDocument: {
  activeElement: FakeFocusable | null;
  querySelector: () => null;
  querySelectorAll: (selector: string) => FakeInput[];
} = {
  activeElement: input,
  querySelector: () => null,
  querySelectorAll: (selector: string) => selector === "#input" ? [input] : [],
};
const timers = new Map<number, () => void>();
let nextTimerId = 1;

const SELECTORS: SiteSelectors = {
  codeBlocks: "code",
  inputArea: "#input",
  messageBlocks: ".message",
  sendButton: ".send",
  stopButton: ".stop",
};

async function main(): Promise<void> {
  installBrowserGlobals();
  const { cancelAutoSend, triggerAutoSend } = await import("../src/modules/auto_send");

  const followUpInput = new FakeInput();
  const followUpHost: FakeFocusable = {
    focus: () => {fakeDocument.activeElement = followUpHost;},
    shadowRoot: { activeElement: followUpInput },
  };
  fakeDocument.activeElement = followUpHost;
  input.innerText = "message";
  const successfulSend = triggerAutoSend({ autoSend: true, hasFileUpload: false }, SELECTORS);
  flushNextTimer();
  assertEqual(fakeDocument.activeElement, followUpInput, "auto-send did not restore follow-up input focus");
  flushNextTimer();
  assertEqual(await successfulSend, "sent", "successful send did not resolve as sent");

  input.innerText = "message";
  const cancelledSend = triggerAutoSend({ autoSend: true, hasFileUpload: false }, SELECTORS);
  cancelAutoSend();
  assertEqual(await cancelledSend, "cancelled", "cancelled send did not resolve");
  assertEqual(timers.size, 0, "cancelled send left a retry timer");

  assertEqual(
    await triggerAutoSend({ autoSend: false, hasFileUpload: false }, SELECTORS),
    "disabled",
    "disabled auto-send did not resolve"
  );
}

function installBrowserGlobals(): void {
  class FakeKeyboardEvent extends Event {
    public readonly key: string;

    public constructor(type: string, init: KeyboardEventInit) {
      super(type, init);
      this.key = init.key ?? "";
    }
  }
  class FakeTextControl {}

  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US" },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getComputedStyle: () => ({ display: "block", pointerEvents: "auto", visibility: "visible" }),
    },
  });
  Object.defineProperty(globalThis, "HTMLInputElement", {
    configurable: true,
    value: FakeTextControl,
  });
  Object.defineProperty(globalThis, "HTMLTextAreaElement", {
    configurable: true,
    value: FakeTextControl,
  });
  Object.defineProperty(globalThis, "KeyboardEvent", {
    configurable: true,
    value: FakeKeyboardEvent,
  });
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: (handler: () => void) => {
      const id = nextTimerId++;
      timers.set(id, handler);
      return id;
    },
  });
  Object.defineProperty(globalThis, "clearTimeout", {
    configurable: true,
    value: (id: number) => timers.delete(id),
  });
}

function flushNextTimer(): void {
  const entry = timers.entries().next().value as [number, () => void] | undefined;
  if (!entry) {throw new Error("missing scheduled auto-send timer");}
  timers.delete(entry[0]);
  entry[1]();
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

void main();
