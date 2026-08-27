import {
  ChatGptEventStreamDecoder,
  extractToolCallTextCandidates,
  PROTOCOL,
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

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const config = activeConfig;
  if (!config || !shouldCaptureRequest(input, init, config.capture)) {
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

    const decoder = new ChatGptEventStreamDecoder({ channels: config.capture.channels });
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
    postCaptureEvent({
      calls: result.messages.flatMap((message) =>
        extractToolCallTextCandidates(message.text)
          .map((text, index) => ({ index, messageId: message.id, text }))
      ),
      captureId,
      conversationId: result.conversationId,
      event: "completed",
      token: config.token,
      type: PROTOCOL.networkCaptureEventMessage,
      url: requestUrl,
    });
  } catch (error) {
    postFailedCapture(config.token, captureId, requestUrl, getErrorMessage(error));
  }
}

async function consumeResponseBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  textDecoder: TextDecoder,
  decoder: ChatGptEventStreamDecoder
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

function shouldCaptureRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  config: SiteNetworkCaptureConfig
): boolean {
  if (config.adapter !== "chatgpt-delta-v1" || config.transport !== "fetch-sse") {
    return false;
  }
  if (getRequestMethod(input, init) !== config.method) {
    return false;
  }
  return urlsMatch(getRequestUrl(input), config.url);
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
