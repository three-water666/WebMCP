import { DomToolActivityController } from "../src/content/dom_tool_activity";
import {
  ToolActivityTracker,
  type ToolActivitySnapshot,
} from "../src/content/tool_activity";
import type { ToolExecutionPayload } from "../src/types";

const FIRST_PAYLOAD: ToolExecutionPayload = {
  arguments: { path: "README.md" },
  name: "read_file",
  purpose: "Read the project documentation",
};

const SECOND_PAYLOAD: ToolExecutionPayload = {
  arguments: { query: "ToolActivityTracker" },
  name: "search_files",
  purpose: "Find the activity tracker",
};

function main(): void {
  runTest("DOM calls in one assistant message share an activity turn", testGroupsMessageCalls);
  runTest("DOM calls from a new assistant message create a new activity turn", testCreatesNewMessageTurn);
  runTest("reset gives an existing message a new activity turn", testResetStartsNewTurn);
}

function testGroupsMessageCalls(): void {
  const harness = createHarness();
  const messageElement = {} as Element;

  harness.controller.capture({
    identity: { requestKey: "dom-key-1" },
    messageElement,
    payload: FIRST_PAYLOAD,
  });
  harness.controller.capture({
    identity: { requestKey: "dom-key-2" },
    messageElement,
    payload: SECOND_PAYLOAD,
  });

  const snapshot = harness.getSnapshot();
  assertEqual(snapshot.turns.length, 1, "calls from one message were split into multiple turns");
  assertEqual(snapshot.items.length, 2, "not all DOM calls were registered");
  assert(snapshot.items.every((item) => item.source === "dom"), "DOM calls did not retain their source");
  assertEqual(snapshot.turns[0]?.requestKeys.join(","), "dom-key-1,dom-key-2", "DOM call order changed");
}

function testCreatesNewMessageTurn(): void {
  const harness = createHarness();

  harness.controller.capture({
    identity: { requestKey: "dom-key-1" },
    messageElement: {} as Element,
    payload: FIRST_PAYLOAD,
  });
  harness.controller.capture({
    identity: { requestKey: "dom-key-2" },
    messageElement: {} as Element,
    payload: SECOND_PAYLOAD,
  });

  const snapshot = harness.getSnapshot();
  assertEqual(snapshot.turns.length, 2, "calls from separate messages shared an activity turn");
  assert(snapshot.turns[0]?.id !== snapshot.turns[1]?.id, "separate DOM turns reused an identifier");
}

function testResetStartsNewTurn(): void {
  const harness = createHarness();
  const messageElement = {} as Element;

  harness.controller.capture({
    identity: { requestKey: "dom-key-1" },
    messageElement,
    payload: FIRST_PAYLOAD,
  });
  const firstTurnId = harness.getSnapshot().turns[0]?.id;
  harness.controller.reset();
  harness.controller.capture({
    identity: { requestKey: "dom-key-2" },
    messageElement,
    payload: SECOND_PAYLOAD,
  });

  const snapshot = harness.getSnapshot();
  assertEqual(snapshot.turns.length, 2, "reset reused the existing DOM activity turn");
  assert(snapshot.turns[1]?.id !== firstTurnId, "reset did not assign a fresh DOM turn identifier");
}

function createHarness(): {
  controller: DomToolActivityController;
  getSnapshot: () => ToolActivitySnapshot;
} {
  const tracker = new ToolActivityTracker();
  const controller = new DomToolActivityController(tracker);
  let snapshot: ToolActivitySnapshot = { items: [], turns: [] };
  tracker.subscribe((value) => {snapshot = value;});
  return { controller, getSnapshot: () => snapshot };
}

function runTest(name: string, test: () => void): void {
  try {
    test();
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

main();
