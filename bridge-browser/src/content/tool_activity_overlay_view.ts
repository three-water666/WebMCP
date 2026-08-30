import { t } from "../modules/i18n";
import {
  type ToolActivityItem,
  type ToolActivitySnapshot,
  type ToolActivityStatus,
  type ToolActivityTurn,
} from "./tool_activity";

export type ToolActivityTone = "active" | "error" | "success" | "warn";

export interface ToolActivityTurnEntry {
  items: ToolActivityItem[];
  turn: ToolActivityTurn;
}

const TERMINAL_STATUSES = new Set<ToolActivityStatus>([
  "succeeded",
  "failed",
  "rejected",
]);

const STATUS_LABEL_KEYS: Record<ToolActivityStatus, string> = {
  awaiting_approval: "activity_awaiting_approval",
  captured: "activity_captured",
  executing: "activity_executing",
  failed: "activity_failed",
  queued: "activity_queued",
  rejected: "activity_rejected",
  succeeded: "activity_succeeded",
};

export function getActivityTurnEntries(snapshot: ToolActivitySnapshot): ToolActivityTurnEntry[] {
  const items = new Map(snapshot.items.map((item) => [item.requestKey, item]));
  return snapshot.turns.flatMap((turn) => {
    const turnItems = turn.requestKeys.flatMap((requestKey) => {
      const item = items.get(requestKey);
      return item ? [item] : [];
    });
    return turnItems.length > 0 ? [{ items: turnItems, turn }] : [];
  });
}

export function getItemStatusText(item: ToolActivityItem): string {
  const label = t(STATUS_LABEL_KEYS[item.status]);
  if (item.status !== "executing" || item.startedAt === undefined) {return label;}
  return `${label} · ${formatElapsed(Date.now() - item.startedAt)}`;
}

export function getTurnSummary(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  const completedCount = items.filter((item) => TERMINAL_STATUSES.has(item.status)).length;
  const startedAt = getExecutingStartedAt(items);
  const elapsed = startedAt === undefined ? "" : ` · ${formatElapsed(Date.now() - startedAt)}`;
  return `${completedCount}/${items.length} · ${getTurnStatusText(turn, items)}${elapsed}`;
}

export function getDeliveryText(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  const text = getTurnStatusText(turn, items);
  if (turn.deliveryStatus === "pending" && items.some((item) => !TERMINAL_STATUSES.has(item.status))) {
    return t("waiting_tools");
  }
  return text;
}

export function getTurnTone(turn: ToolActivityTurn, items: ToolActivityItem[]): ToolActivityTone {
  if (turn.deliveryStatus === "failed" || items.some((item) => item.status === "failed")) {return "error";}
  if (items.some((item) => item.status === "rejected")) {return "warn";}
  if (turn.deliveryStatus === "delivered") {return "success";}
  return "active";
}

export function getTurnIcon(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  const tone = getTurnTone(turn, items);
  if (tone === "error") {return "!";}
  if (tone === "warn") {return "×";}
  if (tone === "success") {return "✓";}
  return "●";
}

export function isTurnSettled(turn: ToolActivityTurn): boolean {
  return turn.deliveryStatus === "delivered" || turn.deliveryStatus === "failed";
}

export function isSuccessfulDeliveredTurn(turn: ToolActivityTurn, items: ToolActivityItem[]): boolean {
  return turn.deliveryStatus === "delivered" && items.every((item) => item.status === "succeeded");
}

export function formatTurnTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function getTurnStatusText(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  if (turn.deliveryStatus === "failed") {return t("activity_delivery_failed");}
  if (turn.deliveryStatus === "delivered") {return t("activity_delivered");}
  if (turn.deliveryStatus === "delivering") {return t("activity_delivering");}
  if (turn.deliveryStatus === "waiting" || items.every((item) => TERMINAL_STATUSES.has(item.status))) {
    return t("activity_waiting_delivery");
  }
  if (items.some((item) => item.status === "awaiting_approval")) {
    return t("activity_awaiting_approval");
  }
  if (items.some((item) => item.status === "executing")) {return t("activity_executing");}
  if (items.some((item) => item.status === "queued")) {return t("activity_queued");}
  return t("activity_captured");
}

function getExecutingStartedAt(items: ToolActivityItem[]): number | undefined {
  let startedAt: number | undefined;
  items.forEach((item) => {
    if (item.status !== "executing" || item.startedAt === undefined) {return;}
    startedAt = startedAt === undefined ? item.startedAt : Math.min(startedAt, item.startedAt);
  });
  return startedAt;
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
