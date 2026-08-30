import { BRANDING } from "@webcode/shared";
import { t } from "../modules/i18n";
import {
  type ToolActivityItem,
  type ToolActivitySnapshot,
  type ToolActivityTracker,
  type ToolActivityTurn,
} from "./tool_activity";
import { FloatingPanelDragController } from "./floating_panel_drag";
import { TOOL_ACTIVITY_STYLE_TEXT } from "./tool_activity_overlay_styles";
import {
  formatTurnTime,
  getActivityTurnEntries,
  getDeliveryText,
  getItemStatusText,
  getTurnIcon,
  getTurnSummary,
  getTurnTone,
  isTurnSettled,
  type ToolActivityTurnEntry,
} from "./tool_activity_overlay_view";

const ELAPSED_UPDATE_INTERVAL_MS = 1000;

export class ToolActivityOverlay {
  private collapsed = false;
  private currentTurnId: string | null = null;
  private dismissedTurnId: string | null = null;
  private readonly dragController: FloatingPanelDragController;
  private historyVisible = false;
  private readonly host: HTMLDivElement;
  private latestSnapshot: ToolActivitySnapshot = { items: [], turns: [] };
  private readonly panel: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private ticker: ReturnType<typeof setInterval> | null = null;

  public constructor(tracker: ToolActivityTracker) {
    const view = createOverlayView();
    this.host = view.host;
    this.panel = view.panel;
    this.stack = view.stack;
    this.dragController = new FloatingPanelDragController(this.host);
    tracker.subscribe((snapshot) => this.render(snapshot));
  }

  private render(snapshot: ToolActivitySnapshot): void {
    this.latestSnapshot = snapshot;
    const entries = getActivityTurnEntries(snapshot);
    const currentEntry = entries.at(-1);
    if (!currentEntry || this.dismissedTurnId === currentEntry.turn.id) {
      this.host.style.display = "none";
      this.syncTicker(false);
      return;
    }

    if (currentEntry.turn.id !== this.currentTurnId) {
      this.startTurn(currentEntry.turn.id);
    }

    const historyScrollTop = this.getHistoryScrollTop();
    const historyEntries = entries.slice(0, -1).reverse();
    this.host.style.display = "block";
    this.host.className = this.collapsed && !this.historyVisible ? "current-collapsed" : "";
    this.panel.className = this.collapsed ? "panel collapsed" : "panel";
    this.panel.replaceChildren(
      this.createCurrentHeader(currentEntry, historyEntries.length),
      ...this.createCurrentDetails(currentEntry)
    );
    this.stack.replaceChildren(
      ...(this.historyVisible ? [this.createHistoryPanel(historyEntries)] : []),
      this.panel
    );
    this.restoreHistoryScrollTop(historyScrollTop);
    this.syncTicker(snapshot.items.some((item) => item.status === "executing"));
    this.dragController.scheduleClamp();
  }

  private createCurrentHeader(entry: ToolActivityTurnEntry, historyCount: number): HTMLElement {
    const header = document.createElement("div");
    header.className = "header drag-header";
    header.title = t("activity_drag");
    this.dragController.bindHandle(header);

    const identity = document.createElement("div");
    identity.className = "identity";
    const heading = document.createElement("div");
    heading.className = "heading";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${BRANDING.productName} · ${t("activity_title")}`;
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = getTurnSummary(entry.turn, entry.items);
    heading.append(title, summary);
    identity.append(createTurnMark(entry.turn, entry.items), heading);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(this.createHistoryButton(historyCount), this.createToggleButton());
    if (isTurnSettled(entry.turn)) {
      actions.appendChild(this.createCloseButton(entry.turn.id));
    }
    header.append(identity, actions);
    return header;
  }

  private createCurrentDetails(entry: ToolActivityTurnEntry): HTMLElement[] {
    if (this.collapsed) {return [];}
    return createTurnDetails(entry, "list");
  }

  private createHistoryButton(historyCount: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = this.historyVisible ? "history-button active" : "history-button";
    button.title = t(this.historyVisible ? "activity_hide_history" : "activity_show_history");
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(this.historyVisible));
    button.textContent = `${t("activity_history")} (${historyCount})`;
    button.onclick = () => {
      this.historyVisible = !this.historyVisible;
      this.render(this.latestSnapshot);
    };
    return button;
  }

  private createHistoryPanel(entries: ToolActivityTurnEntry[]): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "history-panel";

    const header = document.createElement("div");
    header.className = "history-header drag-header";
    header.title = t("activity_drag");
    this.dragController.bindHandle(header);
    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = `${t("activity_history")} · ${entries.length}`;
    header.append(title, this.createHistoryCloseButton());

    const list = document.createElement("div");
    list.className = "history-list";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t("activity_no_history");
      list.appendChild(empty);
    } else {
      entries.forEach((entry) => list.appendChild(createHistoryTurn(entry)));
    }
    panel.append(header, list);
    return panel;
  }

  private createHistoryCloseButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button close";
    button.title = t("activity_hide_history");
    button.setAttribute("aria-label", button.title);
    button.textContent = "×";
    button.onclick = () => {
      this.historyVisible = false;
      this.render(this.latestSnapshot);
    };
    return button;
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
    this.currentTurnId = turnId;
    this.dismissedTurnId = null;
    this.collapsed = false;
  }

  private syncTicker(shouldRun: boolean): void {
    if (shouldRun && !this.ticker) {
      this.ticker = setInterval(() => this.render(this.latestSnapshot), ELAPSED_UPDATE_INTERVAL_MS);
    } else if (!shouldRun && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private getHistoryScrollTop(): number {
    if (!this.historyVisible) {return 0;}
    return this.stack.querySelector<HTMLElement>(".history-list")?.scrollTop ?? 0;
  }

  private restoreHistoryScrollTop(scrollTop: number): void {
    if (!this.historyVisible) {return;}
    const history = this.stack.querySelector<HTMLElement>(".history-list");
    if (history) {history.scrollTop = scrollTop;}
  }
}

function createHistoryTurn(entry: ToolActivityTurnEntry): HTMLElement {
  const turn = document.createElement("section");
  turn.className = "history-turn";
  const header = document.createElement("div");
  header.className = "history-turn-header";
  const heading = document.createElement("div");
  heading.className = "turn-heading";
  const time = document.createElement("div");
  time.className = "turn-name";
  time.textContent = formatTurnTime(entry.turn.createdAt);
  const summary = document.createElement("div");
  summary.className = "turn-meta";
  summary.textContent = getTurnSummary(entry.turn, entry.items);
  heading.append(time, summary);
  header.append(createTurnMark(entry.turn, entry.items), heading);
  turn.append(header, ...createTurnDetails(entry, "history-tool-list"));
  return turn;
}

function createTurnMark(turn: ToolActivityTurn, items: ToolActivityItem[]): HTMLElement {
  const mark = document.createElement("span");
  mark.className = `mark ${getTurnTone(turn, items)}`;
  mark.textContent = getTurnIcon(turn, items);
  return mark;
}

function createTurnDetails(entry: ToolActivityTurnEntry, listClassName: string): HTMLElement[] {
  const list = document.createElement("div");
  list.className = listClassName;
  entry.items.forEach((item) => list.appendChild(createActivityRow(item)));

  const footer = document.createElement("div");
  footer.className = `footer ${getTurnTone(entry.turn, entry.items)}`;
  footer.textContent = getDeliveryText(entry.turn, entry.items);
  return [list, footer];
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

function createOverlayView(): {
  host: HTMLDivElement;
  panel: HTMLDivElement;
  stack: HTMLDivElement;
} {
  const host = document.createElement("div");
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOOL_ACTIVITY_STYLE_TEXT;
  const stack = document.createElement("div");
  stack.className = "overlay-stack";
  const panel = document.createElement("div");
  panel.className = "panel";
  stack.appendChild(panel);
  shadow.append(style, stack);
  document.body.appendChild(host);
  return { host, panel, stack };
}
