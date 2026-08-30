import type { DomToolTurnController } from "../src/content/dom_tool_turn";
import type { ToolRequestRegistry } from "../src/content/tool_request_registry";

interface Harness {
  controller: DomToolTurnController;
  registry: ToolRequestRegistry;
}

interface FakeElement extends Element {
  isConnected: boolean;
}

async function main(): Promise<void> {
  installBrowserGlobals();
  await runTest(
    "keeps capturing the same streamed message after it falls behind the viewport",
    testCapturesGrowingActiveMessage
  );
  await runTest("does not trust an unrelated virtualized history message", testRejectsUnrelatedHistory);
  await runTest("rebinds an active turn after its message element is replaced", testRebindsReplacementElement);
  await runTest("accepts non-virtualized message rerenders without waiting for detachment", testNonVirtualizedRerender);
  await runTest("replaces a streaming code-block identity in the persistent turn", testReplacesStreamingIdentity);
  await runTest("releases active-message trust after delivery is finalized", testFinalizationReleasesTrust);
  await runTest("keeps consecutive non-virtualized messages isolated", testNonVirtualizedMessagesStayIsolated);
}

async function createHarness(): Promise<Harness> {
  const [{ DomToolTurnController }, { ToolRequestRegistry }] = await Promise.all([
    import("../src/content/dom_tool_turn"),
    import("../src/content/tool_request_registry"),
  ]);
  const registry = new ToolRequestRegistry();
  return {
    controller: new DomToolTurnController(registry),
    registry,
  };
}

async function testCapturesGrowingActiveMessage(): Promise<void> {
  const { controller, registry } = await createHarness();
  const messageElement = fakeElement();

  assert(observeMessage(controller, messageElement, false), "live message was not trusted");
  controller.recordRequest(0, "call-0");
  controller.recordRequest(1, "call-1");
  completeTool(registry, "call-0");
  completeTool(registry, "call-1");

  assert(
    observeMessage(controller, messageElement, true),
    "active message was mistaken for virtualized history"
  );
  for (let index = 2; index < 6; index += 1) {
    controller.recordRequest(index, `call-${index}`);
    registry.markRunning(`call-${index}`);
  }

  const batch = controller.getUnflushedBatch();
  assertEqual(batch.totalCount, 6, "persistent turn did not retain all streamed calls");
  assertEqual(batch.completedCount, 2, "partial results were counted against the wrong streamed batch");
  assert(!batch.isComplete, "the first two completed calls prematurely completed the six-call turn");
  assertDeepEqual(
    batch.ids,
    ["call-0", "call-1", "call-2", "call-3", "call-4", "call-5"],
    "persistent turn changed call order"
  );
}

async function testRejectsUnrelatedHistory(): Promise<void> {
  const { controller } = await createHarness();
  const activeMessage = fakeElement();
  assert(observeMessage(controller, activeMessage, false), "live message was not trusted");
  controller.recordRequest(0, "call-0");

  const unrelatedHistory = fakeElement();
  assert(
    !observeMessage(controller, unrelatedHistory, true),
    "unrelated history message replaced the active turn"
  );
  assertDeepEqual(
    controller.getUnflushedBatch().ids,
    ["call-0"],
    "unrelated history changed the active batch"
  );
}

async function testRebindsReplacementElement(): Promise<void> {
  const { controller } = await createHarness();
  const originalMessage = fakeElement();
  assert(observeMessage(controller, originalMessage, false), "live message was not trusted");
  controller.recordRequest(0, "call-0");
  originalMessage.isConnected = false;

  const replacementMessage = fakeElement();
  assert(
    observeMessage(controller, replacementMessage, true),
    "replacement element lost the active turn"
  );
  controller.recordRequest(1, "call-1");
  assertDeepEqual(
    controller.getUnflushedBatch().ids,
    ["call-0", "call-1"],
    "replacement element lost an earlier call"
  );
}

async function testNonVirtualizedRerender(): Promise<void> {
  const { controller } = await createHarness();
  const originalMessage = fakeElement();
  assert(observeMessage(controller, originalMessage, false), "live message was not trusted");
  controller.recordRequest(0, "call-0");

  const replacementMessage = fakeElement();
  assert(
    observeMessage(controller, replacementMessage, false),
    "non-virtualized rerender lost the active turn"
  );
  controller.recordRequest(1, "call-1");
  assertDeepEqual(
    controller.getUnflushedBatch().ids,
    ["call-0", "call-1"],
    "non-virtualized rerender lost an earlier call"
  );
}

async function testReplacesStreamingIdentity(): Promise<void> {
  const { controller } = await createHarness();
  const messageElement = fakeElement();
  assert(observeMessage(controller, messageElement, false), "live message was not trusted");

  controller.recordRequest(0, "invalid-partial-json");
  controller.recordRequest(0, "valid-tool-call");

  assertDeepEqual(
    controller.getUnflushedBatch().ids,
    ["valid-tool-call"],
    "completed JSON retained its obsolete protocol-error identity"
  );
}

async function testFinalizationReleasesTrust(): Promise<void> {
  const { controller, registry } = await createHarness();
  const messageElement = fakeElement();
  assert(observeMessage(controller, messageElement, false), "live message was not trusted");
  controller.recordRequest(0, "call-0");
  completeTool(registry, "call-0");
  registry.markFlushed(["call-0"]);

  controller.finalizeRequests(["call-0"]);

  assert(
    !observeMessage(controller, messageElement, true),
    "finalized message remained trusted while viewing history"
  );
}

async function testNonVirtualizedMessagesStayIsolated(): Promise<void> {
  const { controller, registry } = await createHarness();
  const firstMessage = fakeElement();
  const firstLocation = {
    conversationKey: "https://gemini.google.com/app/conversation-1",
    messageIndex: 0,
  };
  assert(controller.observeMessage(firstMessage, firstLocation, false), "first Gemini message was not trusted");
  controller.recordRequest(0, "first-turn-call");

  const secondMessage = fakeElement();
  const secondLocation = { ...firstLocation, messageIndex: 1 };
  assert(
    !controller.observeMessage(secondMessage, secondLocation, false),
    "a new message replaced an unflushed turn"
  );

  completeTool(registry, "first-turn-call");
  registry.markFlushed(["first-turn-call"]);
  controller.finalizeRequests(["first-turn-call"]);

  assert(controller.observeMessage(secondMessage, secondLocation, false), "second Gemini message was not trusted");
  controller.recordRequest(0, "second-turn-call");
  assertDeepEqual(
    controller.getUnflushedBatch().ids,
    ["second-turn-call"],
    "consecutive non-virtualized messages shared one batch"
  );
}

function observeMessage(
  controller: DomToolTurnController,
  messageElement: Element,
  viewingVirtualizedHistory: boolean
): boolean {
  return controller.observeMessage(messageElement, {
    conversationKey: "https://chat.deepseek.com/a/chat/s/conversation-1",
    messageIndex: 3,
  }, viewingVirtualizedHistory);
}

function fakeElement(): FakeElement {
  return { isConnected: true } as FakeElement;
}

function completeTool(registry: ToolRequestRegistry, requestKey: string): void {
  registry.markRunning(requestKey);
  registry.markSettled(requestKey);
  registry.saveToolResult(requestKey, "done", { toolName: "read_file" });
}

function installBrowserGlobals(): void {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US" },
    });
  }
}

async function runTest(name: string, test: () => Promise<void>): Promise<void> {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assert(condition: unknown, messageText: string): asserts condition {
  if (!condition) {throw new Error(messageText);}
}

function assertEqual(actual: unknown, expected: unknown, messageText: string): void {
  if (actual !== expected) {
    throw new Error(`${messageText}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: readonly string[], expected: readonly string[], messageText: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${messageText}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

void main();
