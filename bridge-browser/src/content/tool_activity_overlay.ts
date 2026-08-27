import { BRANDING } from "@webcode/shared";
import { t } from "../modules/i18n";
import {
  type ToolActivityItem,
  type ToolActivitySnapshot,
  type ToolActivityStatus,
  type ToolActivityTracker,
  type ToolActivityTurn,
} from "./tool_activity";

const SUCCESS_COLLAPSE_DELAY_MS = 4000;
const ELAPSED_UPDATE_INTERVAL_MS = 1000;
const TERMINAL_STATUSES = new Set<ToolActivityStatus>(["succeeded", "failed", "rejected"]);

const STATUS_LABEL_KEYS: Record<ToolActivityStatus, string> = {
  awaiting_approval: "activity_awaiting_approval",
  captured: "activity_captured",
  executing: "activity_executing",
  failed: "activity_failed",
  queued: "activity_queued",
  rejected: "activity_rejected",
  succeeded: "activity_succeeded",
};

export class ToolActivityOverlay {
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private collapseTimerTurnId: string | null = null;
  private collapsed = false;
  private currentTurnId: string | null = null;
  private dismissedTurnId: string | null = null;
  private readonly host: HTMLDivElement;
  private latestSnapshot: ToolActivitySnapshot = { items: [], turns: [] };
  private readonly panel: HTMLDivElement;
  private ticker: ReturnType<typeof setInterval> | null = null;

  public constructor(tracker: ToolActivityTracker) {
    const view = createOverlayView();
    this.host = view.host;
    this.panel = view.panel;
    tracker.subscribe((snapshot) => this.render(snapshot));
  }

  private render(snapshot: ToolActivitySnapshot): void {
    this.latestSnapshot = snapshot;
    const turn = snapshot.turns.at(-1);
    const items = turn ? getTurnItems(snapshot, turn) : [];
    if (!turn || items.length === 0 || this.dismissedTurnId === turn.id) {
      this.host.style.display = "none";
      this.syncTicker(false);
      return;
    }

    if (turn.id !== this.currentTurnId) {
      this.startTurn(turn.id);
    }

    this.host.style.display = "block";
    this.panel.className = this.collapsed ? "panel collapsed" : "panel";
    this.panel.replaceChildren(
      this.createHeader(turn, items),
      ...this.createExpandedContent(turn, items)
    );
    this.syncTicker(items.some((item) => item.status === "executing"));
    this.syncAutoCollapse(turn, items);
  }

  private createHeader(turn: ToolActivityTurn, items: ToolActivityItem[]): HTMLElement {
    const header = document.createElement("div");
    header.className = "header";

    const identity = document.createElement("div");
    identity.className = "identity";
    const mark = document.createElement("span");
    mark.className = `mark ${getTurnTone(turn, items)}`;
    mark.textContent = getTurnIcon(turn, items);
    const heading = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${BRANDING.productName} · ${t("activity_title")}`;
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = getTurnSummary(turn, items);
    heading.append(title, summary);
    identity.append(mark, heading);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(this.createToggleButton());
    if (isTurnSettled(turn)) {
      actions.appendChild(this.createCloseButton(turn.id));
    }
    header.append(identity, actions);
    return header;
  }

  private createExpandedContent(turn: ToolActivityTurn, items: ToolActivityItem[]): HTMLElement[] {
    if (this.collapsed) {return [];}

    const list = document.createElement("div");
    list.className = "list";
    items.forEach((item) => list.appendChild(createActivityRow(item)));

    const footer = document.createElement("div");
    footer.className = `footer ${getTurnTone(turn, items)}`;
    footer.textContent = getDeliveryText(turn, items);
    return [list, footer];
  }

  private createToggleButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.title = t(this.collapsed ? "activity_expand" : "activity_minimize");
    button.setAttribute("aria-label", button.title);
    button.textContent = this.collapsed ? "□" : "−";
    button.onclick = () => {
      this.collapsed = !this.collapsed;
      this.render(this.latestSnapshot);
    };
    return button;
  }

  private createCloseButton(turnId: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button close";
    button.title = t("activity_close");
    button.setAttribute("aria-label", button.title);
    button.textContent = "×";
    button.onclick = () => {
      this.dismissedTurnId = turnId;
      this.host.style.display = "none";
      this.syncTicker(false);
    };
    return button;
  }

  private startTurn(turnId: string): void {
    this.clearCollapseTimer();
    this.currentTurnId = turnId;
    this.dismissedTurnId = null;
    this.collapsed = false;
  }

  private syncAutoCollapse(turn: ToolActivityTurn, items: ToolActivityItem[]): void {
    const shouldCollapse = turn.deliveryStatus === "delivered" &&
      items.every((item) => item.status === "succeeded");
    if (!shouldCollapse) {
      this.clearCollapseTimer();
      return;
    }
    if (this.collapsed || this.collapseTimerTurnId === turn.id) {return;}

    this.collapseTimerTurnId = turn.id;
    this.collapseTimer = setTimeout(() => {
      this.collapseTimer = null;
      this.collapsed = true;
      this.render(this.latestSnapshot);
    }, SUCCESS_COLLAPSE_DELAY_MS);
  }

  private syncTicker(shouldRun: boolean): void {
    if (shouldRun && !this.ticker) {
      this.ticker = setInterval(() => this.render(this.latestSnapshot), ELAPSED_UPDATE_INTERVAL_MS);
    } else if (!shouldRun && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private clearCollapseTimer(): void {
    if (this.collapseTimer) {clearTimeout(this.collapseTimer);}
    this.collapseTimer = null;
    this.collapseTimerTurnId = null;
  }
}

function createActivityRow(item: ToolActivityItem): HTMLElement {
  const row = document.createElement("div");
  row.className = `row ${item.status}`;

  const dot = document.createElement("span");
  dot.className = "status-dot";
  const content = document.createElement("div");
  content.className = "row-content";
  const top = document.createElement("div");
  top.className = "row-top";
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = item.toolName;
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = getItemStatusText(item);
  top.append(name, status);
  content.appendChild(top);

  if (item.purpose) {content.appendChild(createTextLine("purpose", item.purpose));}
  if (item.detail) {content.appendChild(createTextLine("detail", item.detail));}
  if (item.message && (item.status === "failed" || item.status === "rejected")) {
    content.appendChild(createTextLine("message", item.message));
  }
  row.append(dot, content);
  return row;
}

function createTextLine(className: string, value: string): HTMLElement {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = value;
  line.title = value;
  return line;
}

function getItemStatusText(item: ToolActivityItem): string {
  const label = t(STATUS_LABEL_KEYS[item.status]);
  if (item.status !== "executing" || item.startedAt === undefined) {return label;}
  return `${label} · ${formatElapsed(Date.now() - item.startedAt)}`;
}

function getTurnItems(snapshot: ToolActivitySnapshot, turn: ToolActivityTurn): ToolActivityItem[] {
  const items = new Map(snapshot.items.map((item) => [item.requestKey, item]));
  return turn.requestKeys.flatMap((requestKey) => {
    const item = items.get(requestKey);
    return item ? [item] : [];
  });
}

function getTurnSummary(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  const completedCount = items.filter((item) => TERMINAL_STATUSES.has(item.status)).length;
  return `${completedCount}/${items.length} · ${getTurnStatusText(turn, items)}`;
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

function getDeliveryText(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  const text = getTurnStatusText(turn, items);
  if (turn.deliveryStatus === "pending" && items.some((item) => !TERMINAL_STATUSES.has(item.status))) {
    return t("waiting_tools");
  }
  return text;
}

function getTurnTone(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  if (turn.deliveryStatus === "failed" || items.some((item) => item.status === "failed")) {return "error";}
  if (items.some((item) => item.status === "rejected")) {return "warn";}
  if (turn.deliveryStatus === "delivered") {return "success";}
  return "active";
}

function getTurnIcon(turn: ToolActivityTurn, items: ToolActivityItem[]): string {
  const tone = getTurnTone(turn, items);
  if (tone === "error") {return "!";}
  if (tone === "warn") {return "×";}
  if (tone === "success") {return "✓";}
  return "●";
}

function isTurnSettled(turn: ToolActivityTurn): boolean {
  return turn.deliveryStatus === "delivered" || turn.deliveryStatus === "failed";
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function createOverlayView(): { host: HTMLDivElement; panel: HTMLDivElement } {
  const host = document.createElement("div");
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOOL_ACTIVITY_STYLE_TEXT;
  const panel = document.createElement("div");
  panel.className = "panel";
  shadow.append(style, panel);
  document.body.appendChild(host);
  return { host, panel };
}

const TOOL_ACTIVITY_STYLE_TEXT = `
  :host { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; width: min(390px, calc(100vw - 32px)); color-scheme: dark; }
  * { box-sizing: border-box; }
  button { font: inherit; }
  .panel { overflow: hidden; color: #f3f4f6; background: rgba(20, 22, 26, .96); border: 1px solid #3b404a; border-radius: 12px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, .38); font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; backdrop-filter: blur(10px); }
  .panel.collapsed { width: fit-content; min-width: 250px; margin-left: auto; }
  .header { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 10px 9px 12px; }
  .identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
  .mark { width: 24px; height: 24px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #2563eb; font-weight: 700; }
  .mark.active { animation: pulse 1.4s ease-in-out infinite; }
  .mark.success { background: #15803d; }
  .mark.warn { background: #b45309; }
  .mark.error { background: #b91c1c; }
  .title { overflow: hidden; color: #f9fafb; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .summary { overflow: hidden; margin-top: 1px; color: #aeb5c2; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 3px; }
  .icon-button { width: 25px; height: 25px; padding: 0; border: 0; border-radius: 6px; color: #c8ced8; background: transparent; cursor: pointer; }
  .icon-button:hover { color: #fff; background: rgba(255, 255, 255, .1); }
  .icon-button.close:hover { background: #8f1d1d; }
  .list { max-height: min(330px, 45vh); overflow-y: auto; border-top: 1px solid #343942; }
  .row { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .status-dot { width: 8px; height: 8px; flex: 0 0 auto; margin-top: 5px; border-radius: 50%; background: #718096; }
  .row.awaiting_approval .status-dot { background: #f59e0b; }
  .row.executing .status-dot { background: #3b82f6; box-shadow: 0 0 0 4px rgba(59, 130, 246, .13); animation: pulse 1.2s ease-in-out infinite; }
  .row.succeeded .status-dot { background: #22c55e; }
  .row.failed .status-dot, .row.rejected .status-dot { background: #ef4444; }
  .row-content { min-width: 0; flex: 1; }
  .row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .tool-name { overflow: hidden; color: #f3f4f6; font: 600 12px/1.4 "SFMono-Regular", Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
  .status { flex: 0 0 auto; color: #aeb5c2; font-size: 10px; }
  .purpose, .detail, .message { overflow: hidden; margin-top: 3px; text-overflow: ellipsis; white-space: nowrap; }
  .purpose { color: #c4c9d2; }
  .detail { color: #8fb9ff; font-family: "SFMono-Regular", Consolas, monospace; }
  .message { color: #fca5a5; }
  .footer { padding: 8px 12px; color: #9fbfff; background: rgba(37, 99, 235, .1); font-size: 11px; }
  .footer.success { color: #86efac; background: rgba(21, 128, 61, .13); }
  .footer.warn { color: #fcd34d; background: rgba(180, 83, 9, .13); }
  .footer.error { color: #fca5a5; background: rgba(185, 28, 28, .13); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
`;
