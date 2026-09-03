import { FollowUpQueue } from "../src/content/follow_up_queue";
import { ToolActivityTracker } from "../src/content/tool_activity";

interface FakeRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface FakeEvent {
  button: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
  target: FakeElement;
}

class FakeElement {
  public readonly children: FakeElement[] = [];
  public className = "";
  public disabled = false;
  public onclick: (() => void) | null = null;
  public onmousedown: ((event: FakeEvent) => void) | null = null;
  public parentElement: FakeElement | null = null;
  public placeholder = "";
  public shadowRoot: FakeElement | null = null;
  public readonly style: Record<string, string> = {};
  public textContent = "";
  public title = "";
  public type = "";
  public value = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
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

  public addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: FakeEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public click(): void {
    if (!this.disabled) {this.onclick?.();}
  }

  public closest(selector: string): FakeElement | null {
    if (selector === "button" && this.tagName === "button") {return this;}
    return this.parentElement?.closest(selector) ?? null;
  }

  public dispatch(type: string, event: FakeEvent): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  public focus(): void {
    fakeDocument.activeElement = this;
  }

  public getBoundingClientRect(): DOMRect {
    const { height, width } = this.rect;
    const left = parsePixels(this.style.left) ?? this.rect.left;
    const bottom = parsePixels(this.style.bottom);
    const top = parsePixels(this.style.top) ?? (
      bottom === null ? this.rect.top : fakeWindow.innerHeight - bottom - height
    );
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

  public mouseDown(event: FakeEvent): void {
    this.onmousedown?.(event);
  }

  public querySelector<T>(selector: string): T | null {
    const match = selector.startsWith(".")
      ? this.findByClass(selector.slice(1))
      : this.findByTag(selector);
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

  private findByTag(tagName: string): FakeElement | null {
    if (this.tagName === tagName) {return this;}
    for (const child of this.children) {
      const match = child.findByTag(tagName);
      if (match) {return match;}
    }
    return null;
  }
}

class FakeDocument {
  public activeElement: FakeElement | null = null;
  public readonly body = new FakeElement("body");

  public createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  public reset(): void {
    this.activeElement = null;
    this.body.replaceChildren();
  }
}

class FakeWindow {
  public innerHeight = 700;
  public innerWidth = 1000;
  private animationFrameId = 1;
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();

  public addEventListener(type: string, listener: unknown): void {
    if (typeof listener !== "function") {return;}
    const listeners = this.listeners.get(type) ?? new Set<(event: FakeEvent) => void>();
    listeners.add(listener as (event: FakeEvent) => void);
    this.listeners.set(type, listeners);
  }

  public dispatch(type: string, event: FakeEvent): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  public queueAnimationFrame(callback: () => void): number {
    callback();
    return this.animationFrameId++;
  }

  public reset(): void {
    this.innerHeight = 700;
    this.innerWidth = 1000;
    this.listeners.clear();
  }
}

const fakeDocument = new FakeDocument();
const fakeWindow = new FakeWindow();

async function main(): Promise<void> {
  installBrowserGlobals();
  const { FollowUpOverlay } = await import("../src/content/follow_up_overlay");
  runTest("drafts stay isolated until confirmation and disappear after delivery", () => {
    const harness = createHarness(FollowUpOverlay);
    harness.overlay.setGenerating(true);
    const textarea = getRequired(harness.host.shadowRoot!, "textarea");
    textarea.value = "unfinished draft";
    assertEqual(harness.queue.beginDelivery().messages.length, 0, "unfinished draft entered delivery");

    confirmDraft(harness.host, textarea);
    textarea.value = "second detail";
    confirmDraft(harness.host, textarea);
    const delivery = harness.queue.beginDelivery();
    assertEqual(delivery.messages.join("|"), "unfinished draft|second detail", "confirmed text changed");
    assertIncludes(getRequired(harness.host.shadowRoot!, ".queue").getText(), "unfinished draft", "queue hid a confirmed message");

    harness.queue.completeDelivery(delivery.ids);
    assert(!getRequired(harness.host.shadowRoot!, ".queue").getText(), "delivered messages remained visible");
  });
  runTest("composer only appears during work and dragging stays in the viewport", () => {
    const harness = createHarness(FollowUpOverlay);
    assertEqual(harness.host.style.display, "none", "idle composer was visible");
    harness.overlay.setGenerating(true);
    assertEqual(harness.host.style.display, "block", "generation did not show composer");
    harness.overlay.setGenerating(false);
    assertEqual(harness.host.style.display, "none", "idle composer stayed visible");

    captureTool(harness.tracker);
    assertEqual(harness.host.style.display, "block", "tool work did not show composer");
    const header = getRequired(harness.host.shadowRoot!, ".header");
    header.mouseDown(createEvent(header, 20, 420));
    fakeWindow.dispatch("mousemove", createEvent(header, -1000, -1000));
    fakeWindow.dispatch("mouseup", createEvent(header, -1000, -1000));
    assertEqual(harness.host.style.left, "8px", "composer escaped the left edge");
    assertEqual(harness.host.getBoundingClientRect().top, 8, "composer escaped the top edge");
  });
}

interface OverlayInstance {
  setGenerating: (generating: boolean) => void;
}

type OverlayConstructor = new (
  queue: FollowUpQueue,
  tracker: ToolActivityTracker
) => OverlayInstance;

function createHarness(Overlay: OverlayConstructor): {
  host: FakeElement;
  overlay: OverlayInstance;
  queue: FollowUpQueue;
  tracker: ToolActivityTracker;
} {
  fakeDocument.reset();
  fakeWindow.reset();
  const queue = new FollowUpQueue();
  const tracker = new ToolActivityTracker();
  const overlay = new Overlay(queue, tracker);
  const host = fakeDocument.body.children.at(-1);
  assert(host?.shadowRoot, "follow-up overlay was not created");
  host.setRect({ height: 260, left: 20, top: 420, width: 350 });
  return { host, overlay, queue, tracker };
}

function confirmDraft(host: FakeElement, textarea: FakeElement): void {
  textarea.dispatch("input", createEvent(textarea));
  getRequired(host.shadowRoot!, ".confirm").click();
}

function captureTool(tracker: ToolActivityTracker): void {
  tracker.capture({
    identity: { requestKey: "follow-up-tool" },
    payload: { name: "read_file", purpose: "Read context" },
    source: "dom",
    turnId: "follow-up-turn",
  });
}

function createEvent(target: FakeElement, clientX = 0, clientY = 0): FakeEvent {
  return {
    button: 0,
    clientX,
    clientY,
    ctrlKey: false,
    isComposing: false,
    key: "",
    metaKey: false,
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
