async function main(): Promise<void> {
  installBrowserGlobals();
  const [{ ToolCallTracker }, { ToolRequestRegistry }, { parseToolCall }] = await Promise.all([
    import("../src/content/tool_call_tracker"),
    import("../src/content/tool_request_registry"),
    import("../src/modules/toolCallProtocol"),
  ]);
  const tracker = new ToolCallTracker({
    requestRegistry: new ToolRequestRegistry(),
    scheduleMainLoop: () => undefined,
  });
  const parseCall = () => parseToolCall(JSON.stringify({
    arguments: { path: "README.md" },
    mcp_action: "call",
    name: "read_file",
    purpose: "Read the project documentation",
    request_id: "legacy-model-id",
  }));

  await runTest("discards legacy model request IDs", () => {
    assert(!("request_id" in parseCall()), "legacy request ID leaked into the execution payload");
  });

  await runTest("keeps a DOM call stable across code element replacement", () => {
    const message = {} as Element;
    const first = tracker.ensurePayloadRequestIdentity(parseCall(), fakeCodeElement(), message, 0);
    const replacement = tracker.ensurePayloadRequestIdentity(parseCall(), fakeCodeElement(), message, 0);
    assertEqual(replacement.requestKey, first.requestKey, "replacement code element changed the call key");
  });

  await runTest("isolates identical calls in separate conversation messages", () => {
    const first = tracker.ensurePayloadRequestIdentity(parseCall(), fakeCodeElement(), {} as Element, 0);
    const second = tracker.ensurePayloadRequestIdentity(parseCall(), fakeCodeElement(), {} as Element, 0);
    assert(first.requestKey !== second.requestKey, "separate messages reused an internal call key");
  });

  await runTest("scopes network calls to their conversation turn", () => {
    const first = tracker.ensureNetworkPayloadRequestIdentity(parseCall(), "conversation-1:message-1", 0);
    const repeated = tracker.ensureNetworkPayloadRequestIdentity(parseCall(), "conversation-1:message-1", 0);
    const nextConversation = tracker.ensureNetworkPayloadRequestIdentity(
      parseCall(),
      "conversation-2:message-1",
      0
    );
    assertEqual(repeated.requestKey, first.requestKey, "repeated network capture changed the call key");
    assert(first.requestKey !== nextConversation.requestKey, "network conversations reused an internal call key");
  });
}

function fakeCodeElement(): HTMLElement {
  return { dataset: {} } as HTMLElement;
}

function installBrowserGlobals(): void {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US" },
    });
  }
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
