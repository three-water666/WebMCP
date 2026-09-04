export interface FakeRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface FakeEvent {
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

export class FakeElement {
  public readonly children: FakeElement[] = [];
  public className = "";
  public disabled = false;
  public onclick: (() => void) | null = null;
  public onmousedown: ((event: FakeEvent) => void) | null = null;
  public parentElement: FakeElement | null = null;
  public placeholder = "";
  public scrollTop = 0;
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

  public addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: FakeEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

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
    if (!this.disabled) {this.onclick?.();}
  }

  public closest(selector: string): FakeElement | null {
    if (selector === "button" && this.tagName === "button") {return this;}
    return this.parentElement?.closest(selector) ?? null;
  }

  public dispatch(type: string, event = createFakeEvent(this)): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  public focus(): void {
    fakeDocument.activeElement = this;
  }

  public getBoundingClientRect(): DOMRect {
    const { height, width } = this.rect;
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

export const fakeDocument = new FakeDocument();
export const fakeWindow = new FakeWindow();

export function createFakeEvent(target: FakeElement, clientX = 0, clientY = 0): FakeEvent {
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

export function installOverlayBrowserGlobals(): void {
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
