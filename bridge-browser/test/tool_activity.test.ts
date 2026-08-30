import {
  ToolActivityTracker,
  type ToolActivitySnapshot,
} from "../src/content/tool_activity";
import {
  APPROVAL_MODAL_Z_INDEX,
  TOOL_ACTIVITY_OVERLAY_Z_INDEX,
} from "../src/modules/overlay_layers";

function main(): void {
  runTest("activity history retains only the latest eight turns", testRetainsLatestEightTurns);
  runTest("approval UI stays above tool activity", testApprovalLayerPriority);
}

function testRetainsLatestEightTurns(): void {
  const tracker = new ToolActivityTracker();
  let snapshot: ToolActivitySnapshot = { items: [], turns: [] };
  tracker.subscribe((value) => {snapshot = value;});

  for (let index = 1; index <= 9; index += 1) {
    const turnId = `turn-${index}`;
    tracker.capture({
      identity: { requestKey: `request-${index}` },
      payload: { name: `tool-${index}` },
      turnId,
    });
  }

  assertEqual(snapshot.turns.length, 8, "unexpected retained turn count");
  assertEqual(snapshot.items.length, 8, "pruned turn items were retained");
  assertEqual(snapshot.turns[0]?.id, "turn-2", "oldest retained turn was incorrect");
  assertEqual(snapshot.turns.at(-1)?.id, "turn-9", "latest turn was not retained");
}

function testApprovalLayerPriority(): void {
  assert(
    APPROVAL_MODAL_Z_INDEX > TOOL_ACTIVITY_OVERLAY_Z_INDEX,
    "tool activity can cover the approval modal"
  );
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
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

main();
