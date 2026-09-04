import {
  ToolActivityTracker,
  type ToolActivitySnapshot,
} from "../src/content/tool_activity";
import { clampFloatingPanelPosition } from "../src/content/floating_panel_drag";
import {
  APPROVAL_MODAL_Z_INDEX,
  TOOL_ACTIVITY_OVERLAY_Z_INDEX,
} from "../src/modules/overlay_layers";

function main(): void {
  runTest("activity history retains only the latest eight turns", testRetainsLatestEightTurns);
  runTest("clearing history preserves the selected current turn", testClearHistory);
  runTest("approval UI stays above tool activity", testApprovalLayerPriority);
  runTest("floating activity stays inside every viewport edge", testFloatingPanelBounds);
}

function testClearHistory(): void {
  const tracker = new ToolActivityTracker();
  let snapshot: ToolActivitySnapshot = { items: [], turns: [] };
  tracker.subscribe((value) => {snapshot = value;});

  for (let index = 1; index <= 3; index += 1) {
    tracker.capture({
      identity: { requestKey: `request-${index}` },
      payload: { name: `tool-${index}` },
      source: "dom",
      turnId: `turn-${index}`,
    });
  }

  tracker.clearHistory("turn-3");
  assertEqual(snapshot.turns.length, 1, "historical turns were not cleared");
  assertEqual(snapshot.items.length, 1, "historical activity items were not cleared");
  assertEqual(snapshot.turns[0]?.id, "turn-3", "current turn was cleared with history");

  tracker.clearHistory();
  assertEqual(snapshot.turns.length, 0, "archived current turn was not clearable");
  assertEqual(snapshot.items.length, 0, "archived current activity was not clearable");
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
      source: "dom",
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

function testFloatingPanelBounds(): void {
  const panel = { height: 200, width: 300 };
  const viewport = { height: 600, width: 800 };
  assertPosition(
    clampFloatingPanelPosition({ left: -100, top: -100 }, panel, viewport),
    { left: 8, top: 8 },
    "top-left position was not clamped"
  );
  assertPosition(
    clampFloatingPanelPosition({ left: 900, top: 900 }, panel, viewport),
    { left: 492, top: 392 },
    "bottom-right position was not clamped"
  );
  assertPosition(
    clampFloatingPanelPosition({ left: 100, top: 100 }, { height: 700, width: 900 }, viewport),
    { left: 8, top: 8 },
    "oversized panel did not leave its header reachable"
  );
}

function assertPosition(
  actual: { left: number; top: number },
  expected: { left: number; top: number },
  message: string
): void {
  assertEqual(actual.left, expected.left, `${message} (left)`);
  assertEqual(actual.top, expected.top, `${message} (top)`);
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
