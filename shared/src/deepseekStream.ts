import { ServerSentEventDecoder, type ServerSentEvent } from "./sse";

export interface DeepSeekCapturedMessage {
  id: string;
  text: string;
}

export interface DeepSeekCaptureResult {
  complete: boolean;
  messages: DeepSeekCapturedMessage[];
  reason?: "incomplete" | "invalid_stream";
}

interface DeepSeekFragment {
  content: string;
  type: string;
}

interface DeepSeekResponseState {
  fragments: DeepSeekFragment[];
  id: string;
  status: string;
}

interface DeltaOperation {
  o?: unknown;
  p?: unknown;
  v?: unknown;
}

const DEFAULT_MAX_MESSAGE_CHARS = 256_000;

/**
 * Reconstructs the assistant's visible DeepSeek response from its chat SSE stream.
 * THINK fragments are deliberately never exposed so tool calls mentioned during
 * reasoning cannot execute before the model emits them in the final response.
 */
export class DeepSeekEventStreamDecoder {
  private readonly maxMessageChars: number;
  private readonly sseDecoder = new ServerSentEventDecoder();
  private failed = false;
  private lastOperation = "";
  private lastPath = "";
  private readyResponseId: string | null = null;
  private receivedClose = false;
  private response: DeepSeekResponseState | null = null;

  public constructor(options: { maxMessageChars?: number } = {}) {
    this.maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  }

  public push(chunk: string): void {
    this.consumeEvents(this.sseDecoder.push(chunk));
  }

  public finish(): DeepSeekCaptureResult {
    this.consumeEvents(this.sseDecoder.finish());
    if (this.failed) {
      return { complete: false, messages: [], reason: "invalid_stream" };
    }
    if (!this.receivedClose || this.response?.status !== "FINISHED") {
      return { complete: false, messages: [], reason: "incomplete" };
    }

    const text = this.response.fragments
      .filter((fragment) => fragment.type === "RESPONSE")
      .map((fragment) => fragment.content)
      .join("");
    return {
      complete: true,
      messages: text.trim() ? [{ id: this.response.id, text }] : [],
    };
  }

  private consumeEvents(events: readonly ServerSentEvent[]): void {
    events.forEach((event) => this.consumeEvent(event));
  }

  private consumeEvent(event: ServerSentEvent): void {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      this.failed = true;
      return;
    }

    if (event.event === "close") {
      this.receivedClose = true;
      return;
    }
    if (event.event === "error") {
      this.failed = true;
      return;
    }
    if (!isRecord(payload)) {
      return;
    }
    if (event.event === "ready") {
      this.readyResponseId = readId(payload.response_message_id);
      return;
    }
    if (event.event !== "message") {
      return;
    }

    this.consumeDelta(payload);
  }

  private consumeDelta(delta: Record<string, unknown>): void {
    if (hasOwn(delta, "o") && typeof delta.o === "string") {
      this.lastOperation = delta.o.toUpperCase();
    }
    if (hasOwn(delta, "p") && typeof delta.p === "string") {
      this.lastPath = normalizePath(delta.p);
    }

    const rootValue = delta.v;
    if (isRecord(rootValue) && isRecord(rootValue.response)) {
      this.consumeResponse(rootValue.response);
      return;
    }
    if (!this.response) {
      return;
    }
    if (this.lastOperation === "BATCH" && Array.isArray(rootValue)) {
      rootValue.forEach((operation) => {
        if (isRecord(operation)) {
          this.applyOperation(operation, this.lastPath);
        }
      });
      return;
    }

    this.applyOperation({
      o: this.lastOperation,
      p: this.lastPath,
      v: rootValue,
    });
  }

  private consumeResponse(response: Record<string, unknown>): void {
    if (response.role !== "ASSISTANT" || !Array.isArray(response.fragments)) {
      this.failed = true;
      return;
    }
    const id = readId(response.message_id) ?? this.readyResponseId;
    if (!id) {
      this.failed = true;
      return;
    }

    const fragments = response.fragments
      .map(readFragment)
      .filter((fragment): fragment is DeepSeekFragment => Boolean(fragment));
    this.assertMessageLimit(fragments);
    this.response = {
      fragments,
      id,
      status: typeof response.status === "string" ? response.status.toUpperCase() : "",
    };
  }

  private applyOperation(operation: DeltaOperation, basePath = ""): void {
    const response = this.response;
    if (!response) {
      return;
    }
    const operationName = typeof operation.o === "string"
      ? operation.o.toUpperCase()
      : this.lastOperation;
    const operationPath = typeof operation.p === "string"
      ? joinPaths(basePath, operation.p)
      : basePath;

    if (applyResponseStatus(response, operationPath, operation.v)) {
      return;
    }
    if (operationPath === "response/fragments") {
      if (!applyFragmentsOperation(response, operationName, operation.v)) {
        this.failed = true;
        return;
      }
      this.assertMessageLimit(response.fragments);
      return;
    }

    const fragmentContentResult = applyFragmentContent(response, operationName, operationPath, operation.v);
    if (fragmentContentResult === "unsupported") {
      this.failed = true;
    } else if (fragmentContentResult === "applied") {
      this.assertMessageLimit(response.fragments);
    }
  }

  private assertMessageLimit(fragments: readonly DeepSeekFragment[]): void {
    const responseChars = fragments
      .filter((fragment) => fragment.type === "RESPONSE")
      .reduce((total, fragment) => total + fragment.content.length, 0);
    if (responseChars > this.maxMessageChars) {
      this.failed = true;
      throw new Error("Captured DeepSeek message exceeded the size limit.");
    }
  }
}

function applyResponseStatus(response: DeepSeekResponseState, path: string, value: unknown): boolean {
  if (path !== "response/status" || typeof value !== "string") {
    return false;
  }
  response.status = value.toUpperCase();
  return true;
}

function applyFragmentsOperation(
  response: DeepSeekResponseState,
  operation: string,
  value: unknown
): boolean {
  if (operation === "SET" && Array.isArray(value)) {
    response.fragments = value
      .map(readFragment)
      .filter((fragment): fragment is DeepSeekFragment => Boolean(fragment));
    return true;
  }
  if (operation !== "APPEND") {
    return false;
  }
  const values = Array.isArray(value) ? value : [value];
  values.forEach((item) => {
    const fragment = readFragment(item);
    if (fragment) {
      response.fragments.push(fragment);
    }
  });
  return true;
}

function applyFragmentContent(
  response: DeepSeekResponseState,
  operation: string,
  path: string,
  value: unknown
): "applied" | "ignored" | "unsupported" {
  const fragmentIndex = readFragmentContentIndex(path, response.fragments.length);
  if (fragmentIndex === null) {
    return "ignored";
  }
  if ((operation !== "APPEND" && operation !== "SET") || typeof value !== "string") {
    return "unsupported";
  }
  const fragment = response.fragments[fragmentIndex];
  if (!fragment) {
    return "unsupported";
  }
  if (fragment.type !== "RESPONSE") {
    return "applied";
  }
  fragment.content = operation === "APPEND" ? fragment.content + value : value;
  return "applied";
}

function readFragment(value: unknown): DeepSeekFragment | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  const type = value.type.toUpperCase();
  return {
    content: type === "RESPONSE" && typeof value.content === "string" ? value.content : "",
    type,
  };
}

function readFragmentContentIndex(path: string, fragmentCount: number): number | null {
  const match = /^response\/fragments\/(-1|\d+)\/content$/.exec(path);
  if (!match) {
    return null;
  }
  return match[1] === "-1" ? fragmentCount - 1 : Number(match[1]);
}

function joinPaths(basePath: string, childPath: string): string {
  const normalizedBase = normalizePath(basePath);
  const normalizedChild = normalizePath(childPath);
  if (!normalizedBase) {
    return normalizedChild;
  }
  if (!normalizedChild) {
    return normalizedBase;
  }
  return `${normalizedBase}/${normalizedChild}`;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function readId(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
