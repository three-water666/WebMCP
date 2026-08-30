import type { ToolExecutionPayload } from "../types";
import type { ToolRequestIdentity } from "./tool_request_registry";

export type ToolActivityStatus =
  | "captured"
  | "queued"
  | "awaiting_approval"
  | "executing"
  | "succeeded"
  | "failed"
  | "rejected";

export type ToolActivityDeliveryStatus =
  | "pending"
  | "waiting"
  | "delivering"
  | "delivered"
  | "failed";

export interface ToolActivityItem {
  completedAt?: number;
  detail?: string;
  message?: string;
  purpose?: string;
  requestKey: string;
  startedAt?: number;
  status: ToolActivityStatus;
  toolName: string;
  turnId: string;
}

export interface ToolActivityTurn {
  createdAt: number;
  deliveryStatus: ToolActivityDeliveryStatus;
  id: string;
  requestKeys: string[];
}

export interface ToolActivitySnapshot {
  items: ToolActivityItem[];
  turns: ToolActivityTurn[];
}

type ToolActivityListener = (snapshot: ToolActivitySnapshot) => void;

interface CaptureActivityOptions {
  identity: ToolRequestIdentity;
  payload: ToolExecutionPayload;
  turnId: string;
}

interface CaptureProtocolErrorOptions {
  identity: ToolRequestIdentity;
  message: string;
  turnId: string;
}

const TERMINAL_STATUSES = new Set<ToolActivityStatus>([
  "succeeded",
  "failed",
  "rejected",
]);
const MAX_RETAINED_TURNS = 8;

/** Stores user-facing tool activity independently from execution control state. */
export class ToolActivityTracker {
  private readonly items = new Map<string, ToolActivityItem>();
  private readonly listeners = new Set<ToolActivityListener>();
  private readonly turns = new Map<string, ToolActivityTurn>();

  public beginTurn(turnId: string): void {
    if (this.turns.has(turnId)) {return;}

    this.turns.set(turnId, {
      createdAt: Date.now(),
      deliveryStatus: "pending",
      id: turnId,
      requestKeys: [],
    });
    this.pruneTurns();
    this.emit();
  }

  public capture(options: CaptureActivityOptions): void {
    const { identity, payload, turnId } = options;
    if (this.items.has(identity.requestKey)) {return;}

    const turn = this.ensureTurn(turnId);
    turn.requestKeys.push(identity.requestKey);
    this.items.set(identity.requestKey, {
      detail: getPayloadDetail(payload),
      purpose: normalizeText(payload.purpose),
      requestKey: identity.requestKey,
      status: "captured",
      toolName: payload.name,
      turnId,
    });
    this.emit();
  }

  public captureProtocolError(options: CaptureProtocolErrorOptions): void {
    const { identity, message, turnId } = options;
    if (this.items.has(identity.requestKey)) {return;}

    const turn = this.ensureTurn(turnId);
    turn.requestKeys.push(identity.requestKey);
    this.items.set(identity.requestKey, {
      completedAt: Date.now(),
      message,
      requestKey: identity.requestKey,
      status: "failed",
      toolName: "invalid_tool_call",
      turnId,
    });
    this.emit();
  }

  public updateStatus(
    identity: ToolRequestIdentity,
    status: ToolActivityStatus,
    message?: string
  ): void {
    const item = this.items.get(identity.requestKey);
    if (!item) {return;}

    item.status = status;
    item.message = normalizeText(message);
    if (status === "executing" && item.startedAt === undefined) {
      item.startedAt = Date.now();
    }
    if (TERMINAL_STATUSES.has(status)) {
      item.completedAt = Date.now();
    }
    this.emit();
  }

  public updateDelivery(
    requestKeys: readonly string[],
    status: ToolActivityDeliveryStatus
  ): void {
    const turnIds = new Set<string>();
    requestKeys.forEach((requestKey) => {
      const item = this.items.get(requestKey);
      if (item) {turnIds.add(item.turnId);}
    });
    if (turnIds.size === 0) {return;}

    turnIds.forEach((turnId) => {
      const turn = this.turns.get(turnId);
      if (turn) {turn.deliveryStatus = status;}
    });
    this.emit();
  }

  public reset(): void {
    if (this.items.size === 0 && this.turns.size === 0) {return;}
    this.items.clear();
    this.turns.clear();
    this.emit();
  }

  public subscribe(listener: ToolActivityListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private ensureTurn(turnId: string): ToolActivityTurn {
    const existing = this.turns.get(turnId);
    if (existing) {return existing;}

    const turn: ToolActivityTurn = {
      createdAt: Date.now(),
      deliveryStatus: "pending",
      id: turnId,
      requestKeys: [],
    };
    this.turns.set(turnId, turn);
    this.pruneTurns();
    return turn;
  }

  private getSnapshot(): ToolActivitySnapshot {
    return {
      items: Array.from(this.items.values(), (item) => ({ ...item })),
      turns: Array.from(this.turns.values(), (turn) => ({
        ...turn,
        requestKeys: [...turn.requestKeys],
      })),
    };
  }

  private pruneTurns(): void {
    while (this.turns.size > MAX_RETAINED_TURNS) {
      const oldestTurnId = this.turns.keys().next().value;
      if (typeof oldestTurnId !== "string") {return;}

      const oldestTurn = this.turns.get(oldestTurnId);
      oldestTurn?.requestKeys.forEach((requestKey) => this.items.delete(requestKey));
      this.turns.delete(oldestTurnId);
    }
  }
}

function getPayloadDetail(payload: ToolExecutionPayload): string | undefined {
  const payloadArguments = payload.arguments;
  if (!payloadArguments) {return undefined;}

  const preferredKeys = ["command", "path", "query", "pattern", "url", "action"];
  for (const key of preferredKeys) {
    const value = payloadArguments[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {return undefined;}
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}
