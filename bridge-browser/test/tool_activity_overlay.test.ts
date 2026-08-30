import { ToolActivityTracker } from "../src/content/tool_activity";

type OverlayConstructor = new (tracker: ToolActivityTracker) => unknown;

interface ScheduledTimeout {
  callback: () => void;
  cleared: boolean;
  delay: number;
  id: number;
}

class FakeElement {
  public readonly children: FakeElement[] = [];
  public className = "";
  public onclick: (() => void) | null = null;
  public scrollTop = 0;
  public shadowRoot: FakeElement | null = null;
  public readonly style: Record<string, string> = {};
  public textContent = "";
  public title = "";
  public type = "";
  private readonly attributes = new Map<string, string>();

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  public attachShadow(): FakeElement {
    this.shadowRoot = new FakeElement();
    return this.shadowRoot;
  }

  public click(): void {
    this.onclick?.();
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public getText(): string {
    return `${this.textContent}${this.children.map((child) => child.getText()).join("")}`;
  }

  public querySelector<T>(selector: string): T | null {
    const match = this.findByClass(selector.startsWith(".") ? selector.slice(1) : selector);
    return match as T | null;
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  private findByClass(className: string): FakeElement | null {
    if (this.className.split(/\s+/).includes(className)) {return this;}
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) {return match;}
    }
    return null;
  }
}

class FakeDocument {
  public readonly body = new FakeElement();

  public createElement(): FakeElement {
    return new FakeElement();
  }

  public reset(): void {
    this.body.replaceChildren();
  }
}

class FakeTimers {
  private nextId = 1;
  private readonly scheduled: ScheduledTimeout[] = [];

  public getActiveTimeouts(): ScheduledTimeout[] {
    return this.scheduled.filter((timeout) => !timeout.cleared);
  }

  public install(): () => void {
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout");
    const intervalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setInterval");
    const clearIntervalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "clearInterval");

    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      value: (callback: unknown, delay = 0) => this.schedule(callback, delay),
    });
    Object.defineProperty(globalThis, "clearTimeout", {
      configurable: true,
      value: (id: unknown) => this.clear(id),
    });
    Object.defineProperty(globalThis, "setInterval", {
      configurable: true,
      value: () => this.nextId++,
    });
    Object.defineProperty(globalThis, "clearInterval", {
      configurable: true,
      value: () => undefined,
    });

    return () => {
      restoreProperty("setTimeout", timeoutDescriptor);
      restoreProperty("clearTimeout", clearTimeoutDescriptor);
      restoreProperty("setInterval", intervalDescriptor);
      restoreProperty("clearInterval", clearIntervalDescriptor);
    };
  }

  public reset(): void {
    this.scheduled.length = 0;
  }

  public runActiveTimeout(): void {
    const timeout = this.getActiveTimeouts()[0];
    assert(timeout, "expected an active timeout");
    timeout.cleared = true;
    timeout.callback();
  }

  private schedule(callback: unknown, delay: number): number {
    assert(typeof callback === "function", "timer callback was not callable");
    const timeout = { callback: callback as () => void, cleared: false, delay, id: this.nextId++ };
    this.scheduled.push(timeout);
    return timeout.id;
  }

  private clear(id: unknown): void {
    if (typeof id !== "number") {return;}
    const timeout = this.scheduled.find((candidate) => candidate.id === id);
    if (timeout) {timeout.cleared = true;}
  }
}

const fakeDocument = new FakeDocument();
const fakeTimers = new FakeTimers();

async function main(): Promise<void> {
  installBrowserGlobals();
  const restoreTimers = fakeTimers.install();
  try {
    const { ToolActivityOverlay } = await import("../src/content/tool_activity_overlay");
    runTest("history keeps current activity live without losing reading state", () => {
      testHistoryLiveUpdates(ToolActivityOverlay);
    });
    runTest("a new turn keeps history open and moves the prior turn down", () => {
      testNewTurnKeepsHistoryOpen(ToolActivityOverlay);
    });
  } finally {
    restoreTimers();
  }
}

function testHistoryLiveUpdates(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  const firstKey = captureTurn(harness.tracker, "turn-1", "read_file");
  settleTurn(harness.tracker, firstKey);
  const currentKey = captureTurn(harness.tracker, "turn-2", "execute_command");
  harness.tracker.updateStatus({ requestKey: currentKey }, "executing");

  clickTab(harness.panel, 1);
  assert(harness.panel.querySelector<FakeElement>(".history-view"), "history view did not open");
  assertIncludes(getRequired(harness.panel, ".current-turn").getText(), "Running", "current status was missing");

  getRequired(harness.panel, ".history-list").querySelector<FakeElement>(".turn-summary")?.click();
  const historyBeforeUpdate = getRequired(harness.panel, ".history-list");
  historyBeforeUpdate.scrollTop = 41;
  assert(historyBeforeUpdate.querySelector<FakeElement>(".turn-details"), "history turn did not expand");

  harness.tracker.updateStatus({ requestKey: currentKey }, "awaiting_approval");
  const historyAfterUpdate = getRequired(harness.panel, ".history-list");
  assertEqual(historyAfterUpdate.scrollTop, 41, "live update reset the history scroll position");
  assert(historyAfterUpdate.querySelector<FakeElement>(".turn-details"), "live update collapsed the history turn");
  assertIncludes(getRequired(harness.panel, ".current-turn").getText(), "Approval", "approval state did not update");

  settleTurn(harness.tracker, currentKey);
  assertEqual(fakeTimers.getActiveTimeouts().length, 0, "history view scheduled auto-collapse");
  clickTab(harness.panel, 0);
  const activeTimeouts = fakeTimers.getActiveTimeouts();
  assertEqual(activeTimeouts.length, 1, "current view did not resume auto-collapse");
  assertEqual(activeTimeouts[0]?.delay, 4000, "current view used the wrong collapse delay");
  fakeTimers.runActiveTimeout();
  assertEqual(harness.panel.className, "panel collapsed", "successful current view did not collapse");
}

function testNewTurnKeepsHistoryOpen(Overlay: OverlayConstructor): void {
  const harness = createHarness(Overlay);
  captureTurn(harness.tracker, "turn-1", "read_file");
  clickTab(harness.panel, 1);

  captureTurn(harness.tracker, "turn-2", "write_file");
  assert(harness.panel.querySelector<FakeElement>(".history-view"), "new turn switched away from history");
  getRequired(harness.panel, ".current-turn").querySelector<FakeElement>(".turn-summary")?.click();
  assertIncludes(getRequired(harness.panel, ".current-turn").getText(), "write_file", "new turn was not pinned");

  const history = getRequired(harness.panel, ".history-list");
  history.querySelector<FakeElement>(".turn-summary")?.click();
  assertIncludes(getRequired(harness.panel, ".history-list").getText(), "read_file", "prior turn was not moved to history");
  assertIncludes(getTab(harness.panel, 1).getText(), "(2)", "history tab count did not update");
}

function createHarness(Overlay: OverlayConstructor): {
  panel: FakeElement;
  tracker: ToolActivityTracker;
} {
  fakeDocument.reset();
  fakeTimers.reset();
  const tracker = new ToolActivityTracker();
  new Overlay(tracker);
  const host = fakeDocument.body.children.at(-1);
  const panel = host?.shadowRoot?.querySelector<FakeElement>(".panel");
  assert(panel, "tool activity panel was not created");
  return { panel, tracker };
}

function captureTurn(tracker: ToolActivityTracker, turnId: string, toolName: string): string {
  const requestKey = `request:${turnId}`;
  tracker.capture({
    identity: { requestKey },
    payload: { name: toolName, purpose: `Run ${toolName}` },
    turnId,
  });
  return requestKey;
}

function settleTurn(tracker: ToolActivityTracker, requestKey: string): void {
  tracker.updateStatus({ requestKey }, "succeeded");
  tracker.updateDelivery([requestKey], "delivered");
}

function clickTab(panel: FakeElement, index: number): void {
  getTab(panel, index).click();
}

function getTab(panel: FakeElement, index: number): FakeElement {
  const tabs = getRequired(panel, ".tabs");
  const tab = tabs.children[index];
  assert(tab, `missing activity tab ${index}`);
  return tab;
}

function getRequired(root: FakeElement, selector: string): FakeElement {
  const element = root.querySelector<FakeElement>(selector);
  assert(element, `missing element ${selector}`);
  return element;
}

function installBrowserGlobals(): void {
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US" },
  });
}

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
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
