import { FollowUpQueue } from "../src/content/follow_up_queue";

interface FakeEvent {
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

class FakeElement {
  public readonly children: FakeElement[] = [];
  public className = "";
  public disabled = false;
  public onclick: (() => void) | null = null;
  public placeholder = "";
  public readonly style: Record<string, string> = {};
  public textContent = "";
  public title = "";
  public type = "";
  public value = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  private readonly tagName: string;

  public constructor(tagName = "div") {
    this.tagName = tagName;
  }

  public addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: FakeEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public append(...children: FakeElement[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  public appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  public click(): void {
    if (!this.disabled) {this.onclick?.();}
  }

  public dispatch(type: string, event: FakeEvent): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  public focus(): void {
    fakeDocument.activeElement = this;
  }

  public getText(): string {
    return `${this.textContent}${this.children.map((child) => child.getText()).join("")}`;
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

  public createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

const fakeDocument = new FakeDocument();

async function main(): Promise<void> {
  installBrowserGlobals();
  const { FollowUpComposer } = await import("../src/content/follow_up_overlay");
  runTest("waiting follow-ups remain visible and removable until delivery starts", () => {
    const queue = new FollowUpQueue();
    const states: Array<{ count: number; sending: boolean }> = [];
    const composer = new FollowUpComposer(queue, (state) => states.push(state));
    const root = composer.element as unknown as FakeElement;
    const textarea = getRequired(root, "textarea");
    textarea.value = "unfinished draft";
    assertEqual(queue.beginDelivery().messages.length, 0, "unfinished draft entered delivery");

    confirmDraft(root, textarea);
    assertIncludes(getRequired(root, ".follow-up-queue").getText(), "unfinished draft", "confirmed message was hidden");
    getRequired(root, ".follow-up-remove").click();
    assertEqual(queue.beginDelivery().messages.length, 0, "removed message remained queued");

    textarea.value = "send this next";
    confirmDraft(root, textarea);
    const delivery = queue.beginDelivery();
    assertEqual(delivery.messages.join("|"), "send this next", "confirmed text changed");
    assert(!composer.element.querySelector(".follow-up-remove"), "sending message could still be removed");
    assert(states.at(-1)?.sending, "sending state was not reported to the parent panel");

    queue.completeDelivery(delivery.ids);
    assert(!getRequired(root, ".follow-up-queue").getText(), "delivered messages remained visible");
    assertEqual(states.at(-1)?.count, 0, "empty queue count was not reported to the parent panel");
  });
  runTest("composer keeps its input mounted and focuses it on request", () => {
    const queue = new FollowUpQueue();
    const composer = new FollowUpComposer(queue, () => undefined);
    const root = composer.element as unknown as FakeElement;
    const textarea = getRequired(root, "textarea");
    textarea.value = "draft stays here";
    composer.focusInput();
    queue.confirm("another message");
    assertEqual(getRequired(root, "textarea"), textarea, "queue update replaced the textarea");
    assertEqual(textarea.value, "draft stays here", "queue update cleared the unfinished draft");
    assertEqual(fakeDocument.activeElement, textarea, "queue update moved focus away from the textarea");
  });
}

function confirmDraft(root: FakeElement, textarea: FakeElement): void {
  textarea.dispatch("input", createEvent());
  getRequired(root, ".follow-up-confirm").click();
}

function createEvent(): FakeEvent {
  return {
    ctrlKey: false,
    isComposing: false,
    key: "",
    metaKey: false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
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
