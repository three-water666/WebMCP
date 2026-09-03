import { FollowUpQueue } from "../src/content/follow_up_queue";
import { ToolActivityTracker, type ToolActivitySource } from "../src/content/tool_activity";
import {
  createFakeEvent,
  fakeDocument,
  type FakeElement,
  fakeWindow,
  installOverlayBrowserGlobals,
} from "./support/fake_overlay_dom";

interface OverlayInstance {
  setEnabled(enabled: boolean): void;
}

type OverlayConstructor = new (
  tracker: ToolActivityTracker,
  followUpQueue: FollowUpQueue
) => OverlayInstance;

interface OverlayHarness {
  host: FakeElement;
  panel: FakeElement;
  queue: FollowUpQueue;
  stack: FakeElement;
  tracker: ToolActivityTracker;
}

let scheduledTimeoutCount = 0;

async function main(): Promise<void> {
  installBrowserGlobals();
  const { ToolActivityOverlay } = await import("../src/content/tool_activity_overlay");
  runTest("history opens as a separate detailed block and keeps current status live", () => {
    testDetailedHistoryBlock(ToolActivityOverlay);
  });
  runTest("a new turn stays current while the prior turn enters detailed history", () => {
    testNewTurnUpdatesHistory(ToolActivityOverlay);
  });
  runTest("current and historical tools show their capture source", () => {
    testCaptureSourceBadges(ToolActivityOverlay);
  });
  runTest("dragging moves the activity stack without losing viewport access", () => {
    testUnifiedBoundedDragging(ToolActivityOverlay);
  });
  runTest("compact work panel stays collapsed through new tool activity", () => {
    testCompactPanelBehavior(ToolActivityOverlay);
  });
  runTest("tool updates preserve the follow-up draft and input focus", () => {
    testStableFollowUpInput(ToolActivityOverlay);
  });
}

function testDetailedHistoryBlock(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  const firstKey = captureTurn(harness.tracker, "turn-1", "read_file");
  settleTurn(harness.tracker, firstKey);
  const currentKey = captureTurn(harness.tracker, "turn-2", "execute_command");
  harness.tracker.updateStatus({ requestKey: currentKey }, "executing");

  assert(!harness.stack.querySelector<FakeElement>(".tabs"), "legacy current/history tabs remain");
  getRequired(harness.panel, ".history-button").click();
  const historyPanel = getRequired(harness.stack, ".history-panel");
  assertEqual(harness.stack.children[0], historyPanel, "history block was not placed above current activity");
  assertEqual(harness.stack.children[1], harness.panel, "current block moved outside the shared stack");
  assertIncludes(historyPanel.getText(), "read_file", "history omitted detailed tool data");
  assertIncludes(historyPanel.getText(), "Run read_file", "history omitted the tool purpose");
  assertIncludes(harness.panel.getText(), "Running", "current status was not kept visible");

  const currentBeforeUpdate = getRequired(harness.panel, ".list");
  currentBeforeUpdate.scrollTop = 67;
  const historyBeforeUpdate = getRequired(harness.stack, ".history-list");
  historyBeforeUpdate.scrollTop = 41;
  harness.tracker.updateStatus({ requestKey: currentKey }, "awaiting_approval");
  assertEqual(getRequired(harness.panel, ".list").scrollTop, 67, "live update reset current scroll");
  assertEqual(getRequired(harness.stack, ".history-list").scrollTop, 41, "live update reset history scroll");
  assertIncludes(harness.panel.getText(), "Approval", "current approval state did not update");

  settleTurn(harness.tracker, currentKey);
  assertEqual(scheduledTimeoutCount, 0, "successful activity scheduled automatic collapse");
  assertEqual(harness.host.className, "work-panel-expanded", "successful activity collapsed automatically");
  assertEqual(historyPanel.style.display, "flex", "completion hid the history block");
}

function testNewTurnUpdatesHistory(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  captureTurn(harness.tracker, "turn-1", "read_file");
  getRequired(harness.panel, ".history-button").click();
  assertIncludes(getRequired(harness.stack, ".history-list").getText(), "No previous", "empty history state was missing");

  captureTurn(harness.tracker, "turn-2", "write_file");
  assertIncludes(harness.panel.getText(), "write_file", "new tool call was not shown as current");
  assertIncludes(getRequired(harness.stack, ".history-list").getText(), "read_file", "prior tool call did not enter history");
  assertIncludes(getRequired(harness.panel, ".history-button").getText(), "(1)", "history count did not update");
}

function testUnifiedBoundedDragging(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  captureTurn(harness.tracker, "turn-1", "read_file");
  const header = getRequired(harness.panel, ".drag-header");
  header.mouseDown(createFakeEvent(header, 620, 420));
  fakeWindow.dispatch("mousemove", createFakeEvent(header, -1000, -1000));
  fakeWindow.dispatch("mouseup", createFakeEvent(header, -1000, -1000));
  assertEqual(harness.host.style.left, "8px", "drag escaped the left viewport edge");
  assertEqual(harness.host.getBoundingClientRect().top, 8, "drag escaped the top viewport edge");

  harness.host.setRect({ height: 500, left: 0, top: 0, width: 380 });
  getRequired(harness.panel, ".history-button").click();
  fakeWindow.flushAnimationFrames();
  assertEqual(harness.host.getBoundingClientRect().top, 8, "opening history moved the stack out of view");
  assertEqual(fakeDocument.body.children.length, 1, "history, current activity, and follow-up used separate hosts");

  fakeWindow.innerHeight = 400;
  fakeWindow.innerWidth = 500;
  harness.host.setRect({ height: 360, left: 0, top: 0, width: 380 });
  fakeWindow.dispatch("resize", {});
  fakeWindow.flushAnimationFrames();
  const resizedRect = harness.host.getBoundingClientRect();
  assert(resizedRect.left >= 8 && resizedRect.right <= 492, "resize left the stack outside horizontal bounds");
  assert(resizedRect.top >= 8 && resizedRect.bottom <= 392, "resize left the stack outside vertical bounds");
}

function testCaptureSourceBadges(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  const domKey = captureTurn(harness.tracker, "turn-1", "read_file", "dom");
  settleTurn(harness.tracker, domKey);
  captureTurn(harness.tracker, "turn-2", "write_file", "network");

  const currentBadge = getRequired(harness.panel, ".source-badge");
  assertEqual(currentBadge.getText(), "Network", "current network source badge was missing");
  assert(currentBadge.className.includes("network"), "network source badge styling was missing");

  getRequired(harness.panel, ".history-button").click();
  const historyBadge = getRequired(harness.stack, ".history-panel").querySelector<FakeElement>(".source-badge");
  assert(historyBadge, "historical DOM source badge was missing");
  assertEqual(historyBadge.getText(), "DOM", "historical DOM source badge had the wrong label");
}

function testCompactPanelBehavior(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay, false);
  assertEqual(harness.host.style.display, "block", "enabled work panel launcher was hidden");
  captureTurn(harness.tracker, "turn-1", "read_file");
  assertEqual(harness.host.className, "", "new tool activity forced the work panel open");
  const launcher = getRequired(harness.host.shadowRoot!, ".launcher");
  assertIncludes(launcher.getText(), "Captured", "launcher omitted current tool status");
  harness.host.setRect({ height: 42, left: 600, top: 638, width: 280 });
  launcher.mouseDown(createFakeEvent(launcher, 620, 650));
  fakeWindow.dispatch("mousemove", createFakeEvent(launcher, 420, 450));
  fakeWindow.dispatch("mouseup", createFakeEvent(launcher, 420, 450));
  launcher.click();
  assertEqual(harness.host.className, "", "dragging the compact launcher opened the panel");

  launcher.click();
  assertEqual(harness.host.className, "work-panel-expanded", "launcher did not expand the shared panel");
  assertEqual(fakeDocument.activeElement, getRequired(harness.host.shadowRoot!, "textarea"), "expanded panel did not focus follow-up input");
  assertEqual(fakeDocument.body.children.length, 1, "tool activity and follow-up used separate overlay hosts");
  getRequired(harness.panel, ".collapse").click();
  assertEqual(harness.host.className, "", "shared panel did not collapse to its launcher");
}

function testStableFollowUpInput(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  const textarea = getRequired(harness.host.shadowRoot!, "textarea");
  textarea.value = "keep this draft";
  textarea.focus();
  const requestKey = captureTurn(harness.tracker, "turn-1", "execute_command");
  harness.tracker.updateStatus({ requestKey }, "executing");
  harness.queue.confirm("send after this turn");

  assertEqual(getRequired(harness.host.shadowRoot!, "textarea"), textarea, "tool update replaced the follow-up input");
  assertEqual(textarea.value, "keep this draft", "tool update cleared the unfinished follow-up draft");
  assertEqual(fakeDocument.activeElement, textarea, "tool update moved focus away from follow-up input");
  assertIncludes(harness.panel.getText(), "send after this turn", "confirmed follow-up was not shown in the shared panel");
}

function createHarness(Overlay: OverlayConstructor, expand = true): OverlayHarness {
  fakeDocument.reset();
  fakeWindow.reset();
  scheduledTimeoutCount = 0;
  const tracker = new ToolActivityTracker();
  const queue = new FollowUpQueue();
  const overlay = new Overlay(tracker, queue);
  const host = fakeDocument.body.children.at(-1);
  const stack = host?.shadowRoot?.querySelector<FakeElement>(".overlay-stack");
  const panel = stack?.querySelector<FakeElement>(".panel");
  assert(host && stack && panel, "tool activity overlay was not created");
  host.setRect({ height: 250, left: 600, top: 400, width: 380 });
  overlay.setEnabled(true);
  if (expand) {getRequired(host.shadowRoot!, ".launcher").click();}
  return { host, panel, queue, stack, tracker };
}

function captureTurn(
  tracker: ToolActivityTracker,
  turnId: string,
  toolName: string,
  source: ToolActivitySource = "dom"
): string {
  const requestKey = `request:${turnId}`;
  tracker.capture({
    identity: { requestKey },
    payload: { name: toolName, purpose: `Run ${toolName}` },
    source,
    turnId,
  });
  return requestKey;
}

function settleTurn(tracker: ToolActivityTracker, requestKey: string): void {
  tracker.updateStatus({ requestKey }, "succeeded");
  tracker.updateDelivery([requestKey], "delivered");
}

function getRequired(root: FakeElement, selector: string): FakeElement {
  const element = root.querySelector<FakeElement>(selector);
  assert(element, `missing element ${selector}`);
  return element;
}

function installBrowserGlobals(): void {
  installOverlayBrowserGlobals();
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: () => {
      scheduledTimeoutCount += 1;
      return scheduledTimeoutCount;
    },
  });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: () => undefined });
  Object.defineProperty(globalThis, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: () => undefined });
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

function assertIncludes(actual: string, expected: string, message: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${message}: expected '${actual}' to include '${expected}'`);
  }
}

void main();
