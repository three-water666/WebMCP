import { PROTOCOL, type SiteNetworkCaptureConfig } from "@webcode/shared";
import type { NetworkCaptureRuntime } from "../src/content/network_capture_runtime";
import type { NetworkCaptureConfigMessage } from "../src/modules/network_capture_protocol";
import type { ToolExecutor } from "../src/content/tool_executor";
import type { ToolRequestIdentity, ToolRequestRegistry } from "../src/content/tool_request_registry";

interface RuntimeHarness {
  deliveredOutputs: string[];
  executedIdentities: ToolRequestIdentity[];
  registry: ToolRequestRegistry;
  runtime: NetworkCaptureRuntime;
  window: FakeWindow;
}

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeWindow {
  public readonly location = {
    href: "https://chatgpt.com/",
    origin: "https://chatgpt.com",
  };
  public readonly postedMessages: unknown[] = [];
  private readonly messageListeners = new Set<MessageListener>();

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== "message" || typeof listener !== "function") {return;}
    this.messageListeners.add(listener as MessageListener);
  }

  public dispatchMessage(data: unknown): void {
    const event = { data, source: this } as unknown as MessageEvent<unknown>;
    this.messageListeners.forEach((listener) => listener(event));
  }

  public postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }
}

const CAPTURE_CONFIG: SiteNetworkCaptureConfig = {
  adapter: "chatgpt-delta-v1",
  channels: ["analysis"],
  enabled: true,
  method: "POST",
  strategy: "network-preferred",
  transport: "fetch-sse",
  url: "https://chatgpt.com/backend-api/f/conversation",
};

const TOOL_CALL = JSON.stringify({
  arguments: { path: "README.md" },
  mcp_action: "call",
  name: "read_file",
  purpose: "Read the project documentation",
});

async function main(): Promise<void> {
  installBrowserGlobals();
  await runTest("reset clears a pending network turn", testResetClearsPendingTurn);
  await runTest("a tool finishing after reset cannot deliver", testLateCompletionCannotDeliver);
  await runTest("enabled config replacement cannot suppress the new site", testConfigReplacementClearsSuppression);
}

async function createHarness(): Promise<RuntimeHarness> {
  const [{ createNetworkCaptureRuntime }, { ToolActivityTracker }, { ToolCallTracker }, { ToolRequestRegistry }] =
    await Promise.all([
      import("../src/content/network_capture_runtime"),
      import("../src/content/tool_activity"),
      import("../src/content/tool_call_tracker"),
      import("../src/content/tool_request_registry"),
    ]);
  const fakeWindow = new FakeWindow();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  const registry = new ToolRequestRegistry();
  const toolActivityTracker = new ToolActivityTracker();
  const toolCallTracker = new ToolCallTracker({ requestRegistry: registry, scheduleMainLoop: () => undefined });
  const deliveredOutputs: string[] = [];
  const executedIdentities: ToolRequestIdentity[] = [];
  const toolExecutor = {
    execute: (_payload: unknown, identity: ToolRequestIdentity) => executedIdentities.push(identity),
  } as unknown as ToolExecutor;
  const runtime = createNetworkCaptureRuntime({
    canDeliver: () => true,
    deliver: (batch) => deliveredOutputs.push(batch.output),
    isConnected: () => true,
    requestRegistry: registry,
    scheduleMainLoop: () => undefined,
    toolActivityTracker,
    toolCallTracker,
    toolExecutor,
  });
  return { deliveredOutputs, executedIdentities, registry, runtime, window: fakeWindow };
}

async function testResetClearsPendingTurn(): Promise<void> {
  const harness = await createHarness();
  ingestNetworkTurn(harness, "capture-1");
  assert(harness.runtime.hasPendingTurns(), "expected the ingested turn to remain pending");

  harness.runtime.reset();

  assert(!harness.runtime.hasPendingTurns(), "reset left a stale pending turn");
  assert(!harness.runtime.shouldSuppressDomCapture(), "reset left DOM capture suppressed");
}

async function testLateCompletionCannotDeliver(): Promise<void> {
  const harness = await createHarness();
  ingestNetworkTurn(harness, "capture-1");
  const oldIdentity = getExecutedIdentity(harness, 0);
  harness.runtime.reset();
  ingestNetworkTurn(harness, "capture-2");
  const newIdentity = getExecutedIdentity(harness, 1);
  assert(oldIdentity.requestKey !== newIdentity.requestKey, "reset did not isolate request identities");

  completeTool(harness, oldIdentity, "stale result");
  harness.runtime.flushReadyTurn();
  assertEqual(harness.deliveredOutputs.length, 0, "a result from the reset lifecycle was delivered");

  completeTool(harness, newIdentity, "current result");
  harness.runtime.flushReadyTurn();
  assertEqual(harness.deliveredOutputs.length, 1, "the current lifecycle result was not delivered");
  assert(harness.deliveredOutputs[0].includes("current result"), "delivery used the stale lifecycle result");
}

async function testConfigReplacementClearsSuppression(): Promise<void> {
  const harness = await createHarness();
  ingestNetworkTurn(harness, "capture-1");
  assert(harness.runtime.shouldSuppressDomCapture(), "pending turn should initially suppress DOM capture");

  harness.runtime.configure({ ...CAPTURE_CONFIG, channels: ["analysis", "commentary"] });

  assert(!harness.runtime.hasPendingTurns(), "config replacement retained the old pending turn");
  assert(!harness.runtime.shouldSuppressDomCapture(), "old turn suppressed DOM capture for the new config");
}

function ingestNetworkTurn(harness: RuntimeHarness, captureId: string): void {
  harness.runtime.configure(CAPTURE_CONFIG);
  const token = getLatestCaptureConfig(harness.window).token;
  const eventBase = {
    captureId,
    token,
    type: PROTOCOL.networkCaptureEventMessage,
    url: CAPTURE_CONFIG.url,
  } as const;
  harness.window.dispatchMessage({ ...eventBase, event: "started" });
  harness.window.dispatchMessage({
    ...eventBase,
    calls: [{ index: 0, messageId: "message-1", text: TOOL_CALL }],
    conversationId: "conversation-1",
    event: "completed",
  });
}

function getLatestCaptureConfig(fakeWindow: FakeWindow): NetworkCaptureConfigMessage {
  const message = fakeWindow.postedMessages.at(-1);
  assert(isCaptureConfigMessage(message), "network capture config was not posted to the page");
  return message;
}

function isCaptureConfigMessage(value: unknown): value is NetworkCaptureConfigMessage {
  if (typeof value !== "object" || value === null) {return false;}
  const record = value as Record<string, unknown>;
  return record.type === PROTOCOL.networkCaptureConfigMessage && typeof record.token === "string";
}

function getExecutedIdentity(harness: RuntimeHarness, index: number): ToolRequestIdentity {
  const identity = harness.executedIdentities[index];
  assert(identity, `expected captured tool call at index ${index}`);
  return identity;
}

function completeTool(harness: RuntimeHarness, identity: ToolRequestIdentity, output: string): void {
  harness.registry.markSettled(identity.requestKey);
  harness.registry.saveToolResult(identity.requestKey, output, { toolName: "read_file" });
}

function installBrowserGlobals(): void {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);}
}

void main();
