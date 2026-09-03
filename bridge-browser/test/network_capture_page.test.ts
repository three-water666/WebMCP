import { PROTOCOL, type SiteNetworkCaptureConfig } from "@webcode/shared";

type MessageListener = (event: MessageEvent<unknown>) => void;
type XhrListener = () => void;

class FakeWindow {
  public fetch = (): Promise<Response> => Promise.resolve(new Response());
  public readonly location = {
    href: "https://chat.deepseek.com/",
    origin: "https://chat.deepseek.com",
  };
  public readonly postedMessages: unknown[] = [];
  private readonly messageListeners = new Set<MessageListener>();

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "message" && typeof listener === "function") {
      this.messageListeners.add(listener as MessageListener);
    }
  }

  public dispatchMessage(data: unknown): void {
    const event = { data, source: this } as unknown as MessageEvent<unknown>;
    this.messageListeners.forEach((listener) => listener(event));
  }

  public postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }
}

class FakeXmlHttpRequest {
  public static readonly DONE = 4;
  public static readonly HEADERS_RECEIVED = 2;
  public static readonly LOADING = 3;
  public readyState = 0;
  public responseText = "";
  public responseType: XMLHttpRequestResponseType = "";
  public status = 0;
  private readonly listeners = new Map<string, XhrListener[]>();

  public addEventListener(type: string, listener: XhrListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public getResponseHeader(name: string): string | null {
    return name.toLowerCase() === "content-type" ? "text/event-stream; charset=utf-8" : null;
  }

  public open(_method: string, _url: string | URL): void {
    this.readyState = 1;
  }

  public send(): void {
    this.status = 200;
    this.readyState = FakeXmlHttpRequest.HEADERS_RECEIVED;
    this.dispatch("readystatechange");
    for (const chunk of splitStream(createDeepSeekStream(), 17)) {
      this.responseText += chunk;
      this.readyState = FakeXmlHttpRequest.LOADING;
      this.dispatch("progress");
    }
    this.readyState = FakeXmlHttpRequest.DONE;
    this.dispatch("readystatechange");
    this.dispatch("loadend");
  }

  private dispatch(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

const CAPTURE_CONFIG: SiteNetworkCaptureConfig = {
  adapter: "deepseek-chat-v0",
  channels: ["response"],
  enabled: true,
  method: "POST",
  strategy: "network-preferred",
  transport: "xhr-sse",
  url: "https://chat.deepseek.com/api/v0/chat/completion",
};

async function main(): Promise<void> {
  const fakeWindow = new FakeWindow();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: FakeXmlHttpRequest,
  });
  await import("../src/page/network_capture");

  fakeWindow.dispatchMessage({
    capture: CAPTURE_CONFIG,
    token: "capture-token",
    type: PROTOCOL.networkCaptureConfigMessage,
  });
  const xhr = new XMLHttpRequest();
  xhr.open("POST", CAPTURE_CONFIG.url);
  xhr.send();

  const captureEvents = fakeWindow.postedMessages.filter(isCaptureEvent);
  assertEqual(captureEvents.length, 2, "expected one started and one completed event");
  assertEqual(captureEvents[0].event, "started", "XHR capture did not announce its start");
  assertEqual(captureEvents[1].event, "completed", "XHR capture did not complete");
  if (captureEvents[1].event !== "completed") {
    throw new Error("expected a completed capture event");
  }
  assertEqual(captureEvents[1].calls.length, 1, "expected one final-response tool call");
  assert(
    captureEvents[1].calls[0].text.includes('"path":"response.txt"'),
    "capture used the THINK fragment instead of the RESPONSE fragment"
  );
  console.log("PASS captures DeepSeek SSE responses transported by XHR");
}

function createDeepSeekStream(): string {
  const thoughtCall = createToolCall("thought.txt");
  const responseCall = createToolCall("response.txt");
  return [
    "event: ready\n",
    'data: {"request_message_id":1,"response_message_id":2,"model_type":"expert"}\n\n',
    `data: ${JSON.stringify({
      v: {
        response: {
          fragments: [{ content: thoughtCall, id: 2, type: "THINK" }],
          message_id: 2,
          role: "ASSISTANT",
          status: "WIP",
        },
      },
    })}\n\n`,
    `data: ${JSON.stringify({
      o: "APPEND",
      p: "response/fragments",
      v: [{ content: `\`\`\`json\n${responseCall}\n\`\`\``, id: 3, type: "RESPONSE" }],
    })}\n\n`,
    'data: {"o":"SET","p":"response/status","v":"FINISHED"}\n\n',
    "event: close\n",
    'data: {"click_behavior":"none","auto_resume":false}\n\n',
  ].join("");
}

function createToolCall(path: string): string {
  return JSON.stringify({
    arguments: { path },
    mcp_action: "call",
    name: "read_file",
    purpose: "Read a file",
  });
}

function splitStream(stream: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < stream.length; index += chunkSize) {
    chunks.push(stream.slice(index, index + chunkSize));
  }
  return chunks;
}

function isCaptureEvent(value: unknown): value is {
  calls: Array<{ text: string }>;
  event: "started" | "completed";
} {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).type === PROTOCOL.networkCaptureEventMessage;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);}
}

void main();
