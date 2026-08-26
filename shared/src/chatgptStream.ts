import { ServerSentEventDecoder, type ServerSentEvent } from "./sse";

export interface ChatGptCapturedMessage {
  id: string;
  text: string;
}

export interface ChatGptCaptureResult {
  complete: boolean;
  conversationId?: string;
  messages: ChatGptCapturedMessage[];
  reason?: "incomplete" | "invalid_stream" | "unsupported_encoding";
}

export interface ChatGptStreamDecoderOptions {
  channels: readonly string[];
  maxMessageChars?: number;
}

interface CapturedMessageState extends ChatGptCapturedMessage {
  endTurn: boolean | null;
  removed: boolean;
  status: string;
}

interface DeltaOperation {
  o?: unknown;
  p?: unknown;
  v?: unknown;
}

interface JsonObjectScanState {
  depth: number;
  escaped: boolean;
  quote: string;
  start: number;
}

const DEFAULT_MAX_MESSAGE_CHARS = 256_000;
const JSON_FENCE_RE = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi;

export class ChatGptEventStreamDecoder {
  private readonly capturedMessages = new Map<string, CapturedMessageState>();
  private readonly messageOrder: string[] = [];
  private readonly sseDecoder = new ServerSentEventDecoder();
  private readonly targetChannels: ReadonlySet<string>;
  private readonly maxMessageChars: number;
  private conversationId?: string;
  private currentMessageId: string | null = null;
  private encodingVersion: string | null = null;
  private failed = false;
  private lastOperation = "";
  private lastPath = "";
  private receivedDone = false;
  private receivedStreamComplete = false;

  public constructor(options: ChatGptStreamDecoderOptions) {
    this.targetChannels = new Set(options.channels);
    this.maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  }

  public push(chunk: string): void {
    this.consumeEvents(this.sseDecoder.push(chunk));
  }

  public finish(): ChatGptCaptureResult {
    this.consumeEvents(this.sseDecoder.finish());
    if (this.failed) {
      return { complete: false, messages: [], reason: "invalid_stream" };
    }
    if (this.encodingVersion !== "v1") {
      return { complete: false, messages: [], reason: "unsupported_encoding" };
    }
    if (!this.receivedDone && !this.receivedStreamComplete) {
      return { complete: false, messages: [], reason: "incomplete" };
    }

    return {
      complete: true,
      conversationId: this.conversationId,
      messages: this.collectCommittedMessages(),
    };
  }

  private consumeEvents(events: readonly ServerSentEvent[]): void {
    events.forEach((event) => this.consumeEvent(event));
  }

  private consumeEvent(event: ServerSentEvent): void {
    if (event.data === "[DONE]") {
      this.receivedDone = true;
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      this.failed = true;
      return;
    }

    if (event.event === "delta_encoding") {
      this.encodingVersion = typeof payload === "string" ? payload : null;
      return;
    }
    if (!isRecord(payload)) {
      return;
    }

    this.consumeTypedPayload(payload);
    if (typeof payload.type !== "string") {
      this.consumeDelta(payload);
    }
  }

  private consumeTypedPayload(payload: Record<string, unknown>): void {
    if (payload.type === "message_stream_complete") {
      this.receivedStreamComplete = true;
    }
    if (payload.type === "message_stream_error" || payload.type === "error") {
      this.failed = true;
    }
    if (typeof payload.conversation_id === "string") {
      this.conversationId = payload.conversation_id;
    }
  }

  private consumeDelta(delta: Record<string, unknown>): void {
    if (hasOwn(delta, "o") && typeof delta.o === "string") {
      this.lastOperation = delta.o;
    }
    if (hasOwn(delta, "p") && typeof delta.p === "string") {
      this.lastPath = delta.p;
    }

    const rootValue = delta.v;
    if (isRecord(rootValue) && isRecord(rootValue.message)) {
      this.consumeMessage(rootValue.message, rootValue.conversation_id);
      return;
    }

    if (this.lastOperation === "patch" && Array.isArray(rootValue)) {
      rootValue.forEach((operation) => {
        if (isRecord(operation)) {
          this.applyOperation(operation);
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

  private consumeMessage(message: Record<string, unknown>, conversationId: unknown): void {
    this.currentMessageId = typeof message.id === "string" ? message.id : null;
    if (typeof conversationId === "string") {
      this.conversationId = conversationId;
    }
    if (!this.currentMessageId || !this.isTargetMessage(message)) {
      return;
    }

    const content = isRecord(message.content) ? message.content : {};
    const state: CapturedMessageState = {
      endTurn: typeof message.end_turn === "boolean" ? message.end_turn : null,
      id: this.currentMessageId,
      removed: false,
      status: typeof message.status === "string" ? message.status : "",
      text: readInitialText(content),
    };
    this.assertMessageLimit(state.text);
    if (!this.capturedMessages.has(state.id)) {
      this.messageOrder.push(state.id);
    }
    this.capturedMessages.set(state.id, state);
  }

  private isTargetMessage(message: Record<string, unknown>): boolean {
    const author = isRecord(message.author) ? message.author : null;
    const content = isRecord(message.content) ? message.content : null;
    return author?.role === "assistant" &&
      content?.content_type === "text" &&
      typeof message.channel === "string" &&
      this.targetChannels.has(message.channel) &&
      (message.recipient === undefined || message.recipient === "all");
  }

  private applyOperation(operation: DeltaOperation): void {
    const state = this.currentMessageId ? this.capturedMessages.get(this.currentMessageId) : undefined;
    if (!state || typeof operation.o !== "string" || typeof operation.p !== "string") {
      return;
    }

    const path = operation.p;
    if (operation.o === "remove") {
      this.applyRemove(state, path);
      return;
    }
    if (this.applyTextOperation(state, operation, path)) {
      return;
    }
    this.applyMessageStateOperation(state, operation, path);
  }

  private applyTextOperation(state: CapturedMessageState, operation: DeltaOperation, path: string): boolean {
    if (path !== "/message/content/parts/0" || typeof operation.v !== "string") {
      return false;
    }
    state.text = operation.o === "append" ? state.text + operation.v : operation.v;
    this.assertMessageLimit(state.text);
    return true;
  }

  private applyMessageStateOperation(state: CapturedMessageState, operation: DeltaOperation, path: string): void {
    if (path === "/message/status" && typeof operation.v === "string") {
      state.status = operation.v;
      return;
    }
    if (path === "/message/end_turn" && typeof operation.v === "boolean") {
      state.endTurn = operation.v;
    }
  }

  private applyRemove(state: CapturedMessageState, path: string): void {
    if (path === "" || path === "/message") {
      state.removed = true;
    }
    if (path === "/message/content/parts/0") {
      state.text = "";
    }
  }

  private collectCommittedMessages(): ChatGptCapturedMessage[] {
    return this.messageOrder
      .map((id) => this.capturedMessages.get(id))
      .filter((state): state is CapturedMessageState => Boolean(
        state && !state.removed && state.status === "finished_successfully" && state.text.trim()
      ))
      .map(({ id, text }) => ({ id, text }));
  }

  private assertMessageLimit(text: string): void {
    if (text.length > this.maxMessageChars) {
      this.failed = true;
      throw new Error("Captured ChatGPT message exceeded the size limit.");
    }
  }
}

export function extractToolCallTextCandidates(text: string): string[] {
  const fencedCandidates = Array.from(text.matchAll(JSON_FENCE_RE))
    .map((match) => match[1]?.trim() ?? "")
    .filter((candidate) => candidate.includes("mcp_action"));
  if (fencedCandidates.length > 0) {
    return fencedCandidates;
  }
  return extractBareJsonObjects(text).filter((candidate) => candidate.includes("mcp_action"));
}

function extractBareJsonObjects(text: string): string[] {
  const objects: string[] = [];
  const state: JsonObjectScanState = { depth: 0, escaped: false, quote: "", start: -1 };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (consumeQuotedCharacter(state, char) || consumeQuoteStart(state, char)) {
      continue;
    }
    const completedStart = consumeObjectBrace(state, char, index);
    if (completedStart !== null) {
      objects.push(text.slice(completedStart, index + 1).trim());
    }
  }
  return objects;
}

function consumeQuotedCharacter(state: JsonObjectScanState, char: string): boolean {
  if (!state.quote) {
    return false;
  }
  if (state.escaped) {
    state.escaped = false;
  } else if (char === "\\") {
    state.escaped = true;
  } else if (char === state.quote) {
    state.quote = "";
  }
  return true;
}

function consumeQuoteStart(state: JsonObjectScanState, char: string): boolean {
  if (char !== "\"" && char !== "'") {
    return false;
  }
  state.quote = char;
  return true;
}

function consumeObjectBrace(state: JsonObjectScanState, char: string, index: number): number | null {
  if (char === "{") {
    if (state.depth === 0) {
      state.start = index;
    }
    state.depth += 1;
    return null;
  }
  if (char !== "}" || state.depth === 0) {
    return null;
  }

  state.depth -= 1;
  if (state.depth !== 0 || state.start < 0) {
    return null;
  }
  const completedStart = state.start;
  state.start = -1;
  return completedStart;
}

function readInitialText(content: Record<string, unknown>): string {
  if (Array.isArray(content.parts) && typeof content.parts[0] === "string") {
    return content.parts[0];
  }
  return typeof content.text === "string" ? content.text : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
