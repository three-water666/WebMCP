import {
  ChatGptEventStreamDecoder,
  DeepSeekEventStreamDecoder,
  extractToolCallTextCandidates,
  PROTOCOL,
  type NetworkCaptureAdapter,
  type SiteNetworkCaptureConfig,
} from "@webcode/shared";
import {
  isNetworkCaptureConfigMessage,
  type NetworkCapturePageEvent,
} from "../modules/network_capture_protocol";

interface ActiveCaptureConfig {
  capture: SiteNetworkCaptureConfig;
  token: string;
}

interface CaptureStreamDecoder {
  finish: () => {
    complete: boolean;
    conversationId?: string;
    messages: Array<{ id: string; text: string }>;
    reason?: string;
  };
  push: (chunk: string) => void;
}

interface XhrRequestDetails {
  method: string;
  url: string;
}

let activeConfig: ActiveCaptureConfig | null = null;

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || !isNetworkCaptureConfigMessage(event.data)) {
    return;
  }
  activeConfig = event.data.capture?.enabled
    ? { capture: event.data.capture, token: event.data.token }
    : null;
});

window.postMessage({ type: PROTOCOL.networkCaptureReadyMessage }, window.location.origin);

const originalFetch = window.fetch.bind(window);
// These methods are restored onto individual XHR instances with Reflect.apply below.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalXhrOpen = XMLHttpRequest.prototype.open;
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalXhrSend = XMLHttpRequest.prototype.send;
const xhrRequestDetails = new WeakMap<XMLHttpRequest, XhrRequestDetails>();

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const config = activeConfig;
  if (config?.capture.transport !== "fetch-sse") {
    return originalFetch(input, init);
  }
  if (!shouldCaptureFetchRequest(input, init, config.capture)) {
    return originalFetch(input, init);
  }

  const captureId = createCaptureId();
  const requestUrl = getRequestUrl(input);
  postCaptureEvent({
    captureId,
    event: "started",
    token: config.token,
    type: PROTOCOL.networkCaptureEventMessage,
    url: requestUrl,
  });

  let response: Response;
  try {
    response = await originalFetch(input, init);
  } catch (error) {
    postFailedCapture(config.token, captureId, requestUrl, getErrorMessage(error));
    throw error;
  }

  if (!shouldCaptureResponse(response)) {
    postFailedCapture(config.token, captureId, requestUrl, "Response is not a successful EventStream.");
    return response;
  }

  try {
    void captureEventStream(response.clone(), config, captureId, requestUrl);
  } catch (error) {
    postFailedCapture(config.token, captureId, requestUrl, getErrorMessage(error));
  }

  return response;
};

XMLHttpRequest.prototype.open = function(
  method: string,
  url: string | URL,
  ...args: unknown[]
): void {
  xhrRequestDetails.set(this, {
    method: method.toUpperCase(),
    url: new URL(String(url), window.location.href).href,
  });
  Reflect.apply(originalXhrOpen, this, [method, url, ...args]);
};

XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null): void {
  const config = activeConfig;
  const request = xhrRequestDetails.get(this);
  const capture = config && request && config.capture.transport === "xhr-sse" &&
      shouldCaptureTarget(request.method, request.url, config.capture)
    ? new XhrEventStreamCapture(this, config, request.url)
    : null;
  try {
    originalXhrSend.call(this, body);
  } catch (error) {
    capture?.fail(getErrorMessage(error));
    throw error;
  }
};

class XhrEventStreamCapture {
  private consumedChars = 0;
  private readonly decoder: CaptureStreamDecoder;
  private readonly captureId = createCaptureId();
  private terminated = false;
  private validatedResponse = false;

  public constructor(
    private readonly xhr: XMLHttpRequest,
    private readonly config: ActiveCaptureConfig,
    private readonly requestUrl: string
  ) {
    this.decoder = createCaptureDecoder(config.capture);
    this.postStarted();
    xhr.addEventListener("readystatechange", () => this.handleReadyStateChange());
    xhr.addEventListener("progress", () => this.consumeAvailableText());
    xhr.addEventListener("loadend", () => this.complete());
    xhr.addEventListener("abort", () => this.fail("Request was aborted."));
    xhr.addEventListener("error", () => this.fail("XHR request failed."));
    xhr.addEventListener("timeout", () => this.fail("XHR request timed out."));
  }

  public fail(reason: string): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    postFailedCapture(this.config.token, this.captureId, this.requestUrl, reason);
  }

  private handleReadyStateChange(): void {
    if (this.terminated) {
      return;
    }
    if (this.xhr.readyState >= XMLHttpRequest.HEADERS_RECEIVED && !this.validateResponse()) {
      return;
    }
    if (this.xhr.readyState === XMLHttpRequest.LOADING) {
      this.consumeAvailableText();
    }
  }

  private validateResponse(): boolean {
    if (this.validatedResponse) {
      return true;
    }
    let contentType: string | null;
    try {
      contentType = this.xhr.getResponseHeader("content-type");
    } catch (error) {
      this.fail(getErrorMessage(error));
      return false;
    }
    if (this.xhr.status < 200 || this.xhr.status >= 300 ||
        !contentType?.toLowerCase().includes("text/event-stream")) {
      this.fail("Response is not a successful EventStream.");
      return false;
    }
    if (this.xhr.responseType !== "" && this.xhr.responseType !== "text") {
      this.fail(`Unsupported XHR response type: ${this.xhr.responseType}`);
      return false;
    }
    this.validatedResponse = true;
    return true;
  }

  private consumeAvailableText(): void {
    if (this.terminated || !this.validateResponse()) {
      return;
    }
    let responseText: string;
    try {
      responseText = this.xhr.responseText;
    } catch (error) {
      this.fail(getErrorMessage(error));
      return;
    }
    if (responseText.length < this.consumedChars) {
      this.fail("XHR response text was reset during capture.");
      return;
    }
    if (responseText.length > this.consumedChars) {
      try {
        this.decoder.push(responseText.slice(this.consumedChars));
        this.consumedChars = responseText.length;
      } catch (error) {
        this.fail(getErrorMessage(error));
      }
    }
  }

  private complete(): void {
    if (this.terminated || !this.validateResponse()) {
      return;
    }
    try {
      this.consumeAvailableText();
      if (this.terminated) {
        return;
      }
      const result = this.decoder.finish();
      if (!result.complete) {
        this.fail(result.reason ?? "incomplete");
        return;
      }
      this.terminated = true;
      postCompletedCapture(this.config.token, this.captureId, this.requestUrl, result);
    } catch (error) {
      this.fail(getErrorMessage(error));
    }
  }

  private postStarted(): void {
    postCaptureEvent({
      captureId: this.captureId,
      event: "started",
      token: this.config.token,
      type: PROTOCOL.networkCaptureEventMessage,
      url: this.requestUrl,
    });
  }
}

async function captureEventStream(
  response: Response,
  config: ActiveCaptureConfig,
  captureId: string,
  requestUrl: string
): Promise<void> {
  try {
    if (!response.body) {
      throw new Error("Response body is unavailable.");
    }

    const decoder = createCaptureDecoder(config.capture);
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    try {
      await consumeResponseBody(reader, textDecoder, decoder);
    } finally {
      reader.releaseLock();
    }

    const result = decoder.finish();
    if (!result.complete) {
      postFailedCapture(config.token, captureId, requestUrl, result.reason ?? "incomplete");
      return;
    }
    postCompletedCapture(config.token, captureId, requestUrl, result);
  } catch (error) {
    postFailedCapture(config.token, captureId, requestUrl, getErrorMessage(error));
  }
}

async function consumeResponseBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  textDecoder: TextDecoder,
  decoder: CaptureStreamDecoder
): Promise<void> {
  while (true) {
    const result = await reader.read();
    if (result.done) {
      const tail = textDecoder.decode();
      if (tail) {
        decoder.push(tail);
      }
      return;
    }
    decoder.push(textDecoder.decode(result.value, { stream: true }));
  }
}

function shouldCaptureFetchRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  config: SiteNetworkCaptureConfig
): boolean {
  return shouldCaptureTarget(getRequestMethod(input, init), getRequestUrl(input), config);
}

function shouldCaptureTarget(method: string, url: string, config: SiteNetworkCaptureConfig): boolean {
  if (!isSupportedAdapter(config.adapter) || method !== config.method) {
    return false;
  }
  return urlsMatch(url, config.url);
}

function createCaptureDecoder(config: SiteNetworkCaptureConfig): CaptureStreamDecoder {
  switch (config.adapter) {
    case "chatgpt-delta-v1":
      return new ChatGptEventStreamDecoder({ channels: config.channels });
    case "deepseek-chat-v0":
      return new DeepSeekEventStreamDecoder();
  }
}

function isSupportedAdapter(adapter: NetworkCaptureAdapter): boolean {
  return adapter === "chatgpt-delta-v1" || adapter === "deepseek-chat-v0";
}

function shouldCaptureResponse(response: Response): boolean {
  return response.ok &&
    response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") === true;
}

function getRequestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const requestMethod = input instanceof Request ? input.method : undefined;
  return String(init?.method ?? requestMethod ?? "GET").toUpperCase();
}

function getRequestUrl(input: RequestInfo | URL): string {
  const value = input instanceof Request ? input.url : String(input);
  return new URL(value, window.location.href).href;
}

function urlsMatch(actualValue: string, configuredValue: string): boolean {
  try {
    const actual = new URL(actualValue, window.location.href);
    const configured = new URL(configuredValue, window.location.href);
    return actual.origin === configured.origin && normalizePath(actual.pathname) === normalizePath(configured.pathname);
  } catch {
    return false;
  }
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function postFailedCapture(token: string, captureId: string, url: string, reason: string): void {
  postCaptureEvent({
    captureId,
    event: "failed",
    reason,
    token,
    type: PROTOCOL.networkCaptureEventMessage,
    url,
  });
}

function postCompletedCapture(
  token: string,
  captureId: string,
  url: string,
  result: ReturnType<CaptureStreamDecoder["finish"]>
): void {
  postCaptureEvent({
    calls: result.messages.flatMap((message) =>
      extractToolCallTextCandidates(message.text)
        .map((text, index) => ({ index, messageId: message.id, text }))
    ),
    captureId,
    conversationId: result.conversationId,
    event: "completed",
    token,
    type: PROTOCOL.networkCaptureEventMessage,
    url,
  });
}

function postCaptureEvent(event: NetworkCapturePageEvent): void {
  window.postMessage(event, window.location.origin);
}

function createCaptureId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
