import {
  ToolActivityTracker,
  type ToolActivitySource,
} from "../src/content/tool_activity";

type OverlayConstructor = new (tracker: ToolActivityTracker) => unknown;

interface FakeRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface FakeMouseEvent {
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
  target: FakeElement;
}

class FakeElement {
  public readonly children: FakeElement[] = [];
  public className = "";
  public onclick: (() => void) | null = null;
  public onmousedown: ((event: FakeMouseEvent) => void) | null = null;
  public parentElement: FakeElement | null = null;
  public scrollTop = 0;
  public shadowRoot: FakeElement | null = null;
  public readonly style: Record<string, string> = {};
  public textContent = "";
  public title = "";
  public type = "";
  private readonly attributes = new Map<string, string>();
  private rect: FakeRect = { height: 0, left: 0, top: 0, width: 0 };

  public constructor(private readonly tagName = "div") {}

  public append(...children: FakeElement[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  public appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public attachShadow(): FakeElement {
    this.shadowRoot = new FakeElement("shadow-root");
    return this.shadowRoot;
  }

  public click(): void {
    this.onclick?.();
  }

  public closest(selector: string): FakeElement | null {
    if (selector === "button" && this.tagName === "button") {return this;}
    return this.parentElement?.closest(selector) ?? null;
  }

  public getBoundingClientRect(): DOMRect {
    const width = this.rect.width;
    const height = this.rect.height;
    const left = parsePixels(this.style.left) ?? this.getRightAnchoredLeft(width) ?? this.rect.left;
    const top = parsePixels(this.style.top) ?? this.getBottomAnchoredTop(height) ?? this.rect.top;
    return {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  }

  public getText(): string {
    return `${this.textContent}${this.children.map((child) => child.getText()).join("")}`;
  }

  public mouseDown(event: FakeMouseEvent): void {
    this.onmousedown?.(event);
  }

  public querySelector<T>(selector: string): T | null {
    const match = this.findByClass(selector.startsWith(".") ? selector.slice(1) : selector);
    return match as T | null;
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.append(...children);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public setRect(rect: FakeRect): void {
    this.rect = rect;
  }

  private findByClass(className: string): FakeElement | null {
    if (this.className.split(/\s+/).includes(className)) {return this;}
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) {return match;}
    }
    return null;
  }

  private getBottomAnchoredTop(height: number): number | null {
    const bottom = parsePixels(this.style.bottom);
    return bottom === null ? null : fakeWindow.innerHeight - bottom - height;
  }

  private getRightAnchoredLeft(width: number): number | null {
    const right = parsePixels(this.style.right);
    return right === null ? null : fakeWindow.innerWidth - right - width;
  }
}

class FakeDocument {
  public readonly body = new FakeElement("body");

  public createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  public reset(): void {
    this.body.replaceChildren();
  }
}

class FakeWindow {
  public innerHeight = 700;
  public innerWidth = 1000;
  private animationFrameId = 1;
  private readonly animationFrames = new Map<number, () => void>();
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  public addEventListener(type: string, listener: unknown): void {
    if (typeof listener !== "function") {return;}
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener as (event: unknown) => void);
    this.listeners.set(type, listeners);
  }

  public dispatch(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  public flushAnimationFrames(): void {
    const callbacks = Array.from(this.animationFrames.values());
    this.animationFrames.clear();
    callbacks.forEach((callback) => callback());
  }

  public queueAnimationFrame(callback: () => void): number {
    const id = this.animationFrameId++;
    this.animationFrames.set(id, callback);
    return id;
  }

  public reset(): void {
    this.innerHeight = 700;
    this.innerWidth = 1000;
    this.animationFrames.clear();
    this.listeners.clear();
  }
}

const fakeDocument = new FakeDocument();
const fakeWindow = new FakeWindow();
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
  assertEqual(harness.panel.className, "panel", "successful activity still collapsed automatically");
  assert(harness.stack.querySelector<FakeElement>(".history-panel"), "completion hid the history block");
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
  header.mouseDown(createMouseEvent(620, 420, header));
  fakeWindow.dispatch("mousemove", createMouseEvent(-1000, -1000, header));
  fakeWindow.dispatch("mouseup", createMouseEvent(-1000, -1000, header));
  assertEqual(harness.host.style.left, "8px", "drag escaped the left viewport edge");
  assertEqual(harness.host.getBoundingClientRect().top, 8, "drag escaped the top viewport edge");

  harness.host.setRect({ height: 500, left: 0, top: 0, width: 380 });
  getRequired(harness.panel, ".history-button").click();
  fakeWindow.flushAnimationFrames();
  assertEqual(harness.host.getBoundingClientRect().top, 8, "opening history moved the stack out of view");
  assertEqual(fakeDocument.body.children.length, 1, "history and current activity used separate hosts");

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

function createHarness(Overlay: OverlayConstructor): {
  host: FakeElement;
  panel: FakeElement;
  stack: FakeElement;
  tracker: ToolActivityTracker;
} {
  fakeDocument.reset();
  fakeWindow.reset();
  scheduledTimeoutCount = 0;
  const tracker = new ToolActivityTracker();
  new Overlay(tracker);
  const host = fakeDocument.body.children.at(-1);
  const stack = host?.shadowRoot?.querySelector<FakeElement>(".overlay-stack");
  const panel = stack?.querySelector<FakeElement>(".panel");
  assert(host && stack && panel, "tool activity overlay was not created");
  host.setRect({ height: 250, left: 600, top: 400, width: 380 });
  return { host, panel, stack, tracker };
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

function createMouseEvent(clientX: number, clientY: number, target: FakeElement): FakeMouseEvent {
  return {
    button: 0,
    clientX,
    clientY,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    target,
  };
}

function getRequired(root: FakeElement, selector: string): FakeElement {
  const element = root.querySelector<FakeElement>(selector);
  assert(element, `missing element ${selector}`);
  return element;
}

function installBrowserGlobals(): void {
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: () => void) => fakeWindow.queueAnimationFrame(callback),
  });
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

function parsePixels(value: string | undefined): number | null {
  if (!value || value === "auto") {return null;}
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
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
