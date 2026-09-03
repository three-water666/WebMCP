interface FakeMessage {
  querySelectorAll: () => Array<{ textContent: string }>;
  textContent: string;
}

export {};

let nextTimerId = 1;
const timers = new Map<number, () => void>();
let stopVisible = false;
const message: FakeMessage = {
  querySelectorAll: () => [],
  textContent: "",
};

async function main(): Promise<void> {
  installBrowserGlobals();
  const { CompletionNotifier } = await import("../src/content/completion_notifier");
  let completedCount = 0;
  const notifier = new CompletionNotifier({
    onCompletedWithoutTools: () => {completedCount += 1;},
  });
  const selectors = {
    codeBlocks: "code",
    inputArea: "input",
    messageBlocks: ".message",
    sendButton: ".send",
    stopButton: ".stop",
  };

  notifier.observe(selectors);
  stopVisible = true;
  notifier.observe(selectors);
  message.textContent = "ordinary response";
  stopVisible = false;
  notifier.observe(selectors);
  flushTimers();
  assertEqual(completedCount, 1, "ordinary completion did not trigger follow-up delivery");

  stopVisible = true;
  notifier.observe(selectors);
  message.textContent = "tool response";
  message.querySelectorAll = () => [{
    textContent: '{"mcp_action":"call","name":"read_file","arguments":{}}',
  }];
  stopVisible = false;
  notifier.observe(selectors);
  flushTimers();
  assertEqual(completedCount, 1, "tool completion triggered standalone follow-up delivery");
}

function installBrowserGlobals(): void {
  const stopButton = {
    getBoundingClientRect: () => ({ height: 20, width: 20 }),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US" },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getComputedStyle: () => ({ display: "block", pointerEvents: "auto", visibility: "visible" }),
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: (selector: string) => selector === ".stop" && stopVisible ? stopButton : null,
      querySelectorAll: (selector: string) => selector === ".message" ? [message] : [],
    },
  });
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: (handler: () => void) => {
      const id = nextTimerId++;
      timers.set(id, handler);
      return id;
    },
  });
  Object.defineProperty(globalThis, "clearTimeout", {
    configurable: true,
    value: (id: number) => timers.delete(id),
  });
}

function flushTimers(): void {
  const callbacks = [...timers.values()];
  timers.clear();
  callbacks.forEach((callback) => callback());
}

function assertEqual(actual: unknown, expected: unknown, messageText: string): void {
  if (actual !== expected) {
    throw new Error(`${messageText}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

void main();
