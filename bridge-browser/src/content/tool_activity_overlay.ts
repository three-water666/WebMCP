import { BRANDING } from "@webcode/shared";
import { t } from "../modules/i18n";
import {
  type ToolActivityItem,
  type ToolActivitySnapshot,
  type ToolActivityTracker,
  type ToolActivityTurn,
} from "./tool_activity";
import { TOOL_ACTIVITY_STYLE_TEXT } from "./tool_activity_overlay_styles";
import {
  formatTurnTime,
  getActivityTurnEntries,
  getDeliveryText,
  getItemStatusText,
  getTurnIcon,
  getTurnSummary,
  getTurnTone,
  isSuccessfulDeliveredTurn,
  isTurnSettled,
  type ToolActivityTurnEntry,
} from "./tool_activity_overlay_view";

const SUCCESS_COLLAPSE_DELAY_MS = 4000;
const ELAPSED_UPDATE_INTERVAL_MS = 1000;

type ActivityViewMode = "current" | "history";

export class ToolActivityOverlay {
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private collapseTimerTurnId: string | null = null;
  private collapsed = false;
  private currentTurnId: string | null = null;
  private dismissedTurnId: string | null = null;
  private readonly expandedTurnIds = new Set<string>();
  private readonly host: HTMLDivElement;
  private latestSnapshot: ToolActivitySnapshot = { items: [], turns: [] };
  private readonly panel: HTMLDivElement;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private viewMode: ActivityViewMode = "current";

  public constructor(tracker: ToolActivityTracker) {
    const view = createOverlayView();
    this.host = view.host;
    this.panel = view.panel;
    tracker.subscribe((snapshot) => this.render(snapshot));
  }

  private render(snapshot: ToolActivitySnapshot): void {
    this.latestSnapshot = snapshot;
    const entries = getActivityTurnEntries(snapshot);
    this.pruneExpandedTurns(entries);
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
    this.host.style.display = "block";
    this.panel.className = this.collapsed ? "panel collapsed" : "panel";
    this.panel.replaceChildren(
      this.createHeader(currentEntry),
      ...this.createExpandedContent(entries, currentEntry)
    );
    this.restoreHistoryScrollTop(historyScrollTop);
    this.syncTicker(snapshot.items.some((item) => item.status === "executing"));
    this.syncAutoCollapse(currentEntry);
  }

  private createHeader(entry: ToolActivityTurnEntry): HTMLElement {
    const header = document.createElement("div");
    header.className = "header";

    const identity = document.createElement("div");
    identity.className = "identity";
    const mark = createTurnMark(entry.turn, entry.items);
    const heading = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${BRANDING.productName} · ${t("activity_title")}`;
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = getTurnSummary(entry.turn, entry.items);
    heading.append(title, summary);
    identity.append(mark, heading);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(this.createToggleButton());
    if (isTurnSettled(entry.turn)) {
      actions.appendChild(this.createCloseButton(entry.turn.id));
    }
    header.append(identity, actions);
    return header;
  }

  private createExpandedContent(
    entries: ToolActivityTurnEntry[],
    currentEntry: ToolActivityTurnEntry
  ): HTMLElement[] {
    if (this.collapsed) {return [];}

    const tabs = this.createViewTabs(entries.length);
    if (this.viewMode === "history") {
      return [tabs, this.createHistoryView(entries, currentEntry)];
    }
    return [tabs, ...createTurnDetails(currentEntry)];
  }

  private createViewTabs(turnCount: number): HTMLElement {
    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    tabs.append(
      this.createViewTab("current", t("activity_current")),
      this.createViewTab("history", `${t("activity_history")} (${turnCount})`)
    );
    return tabs;
  }

  private createViewTab(mode: ActivityViewMode, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = this.viewMode === mode ? "view-tab active" : "view-tab";
    button.textContent = label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(this.viewMode === mode));
    button.onclick = () => {
      if (this.viewMode === mode) {return;}
      this.clearCollapseTimer();
      this.viewMode = mode;
      this.render(this.latestSnapshot);
    };
    return button;
  }

  private createHistoryView(
    entries: ToolActivityTurnEntry[],
    currentEntry: ToolActivityTurnEntry
  ): HTMLElement {
    const view = document.createElement("div");
    view.className = "history-view";

    const current = document.createElement("div");
    current.className = "current-turn";
    current.appendChild(this.createTurnCard(currentEntry, true));

    const label = document.createElement("div");
    label.className = "history-label";
    label.textContent = t("activity_previous_turns");

    const history = document.createElement("div");
    history.className = "history-list";
    const previousEntries = entries.slice(0, -1).reverse();
    if (previousEntries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t("activity_no_history");
      history.appendChild(empty);
    } else {
      previousEntries.forEach((entry) => history.appendChild(this.createTurnCard(entry, false)));
    }
    view.append(current, label, history);
    return view;
  }

  private createTurnCard(entry: ToolActivityTurnEntry, isCurrent: boolean): HTMLElement {
    const expanded = this.expandedTurnIds.has(entry.turn.id);
    const card = document.createElement("div");
    card.className = isCurrent ? "turn-card current" : "turn-card";

    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "turn-summary";
    summary.setAttribute("aria-expanded", String(expanded));
    summary.append(
      createTurnMark(entry.turn, entry.items),
      createTurnHeading(entry, isCurrent),
      createChevron(expanded)
    );
    summary.onclick = () => {
      if (expanded) {
        this.expandedTurnIds.delete(entry.turn.id);
      } else {
        this.expandedTurnIds.add(entry.turn.id);
      }
      this.render(this.latestSnapshot);
    };
    card.appendChild(summary);
    if (expanded) {
      card.append(...createTurnDetails(entry, true));
    }
    return card;
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

  private syncAutoCollapse(entry: ToolActivityTurnEntry): void {
    if (this.viewMode === "history" || !isSuccessfulDeliveredTurn(entry.turn, entry.items)) {
      this.clearCollapseTimer();
      return;
    }
    if (this.collapsed || this.collapseTimerTurnId === entry.turn.id) {return;}

    this.collapseTimerTurnId = entry.turn.id;
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

  private getHistoryScrollTop(): number {
    if (this.viewMode !== "history") {return 0;}
    return this.panel.querySelector<HTMLElement>(".history-list")?.scrollTop ?? 0;
  }

  private restoreHistoryScrollTop(scrollTop: number): void {
    if (this.viewMode !== "history") {return;}
    const history = this.panel.querySelector<HTMLElement>(".history-list");
    if (history) {history.scrollTop = scrollTop;}
  }

  private pruneExpandedTurns(entries: ToolActivityTurnEntry[]): void {
    const retainedTurnIds = new Set(entries.map((entry) => entry.turn.id));
    this.expandedTurnIds.forEach((turnId) => {
      if (!retainedTurnIds.has(turnId)) {this.expandedTurnIds.delete(turnId);}
    });
  }

  private clearCollapseTimer(): void {
    if (this.collapseTimer) {clearTimeout(this.collapseTimer);}
    this.collapseTimer = null;
    this.collapseTimerTurnId = null;
  }
}

function createTurnHeading(entry: ToolActivityTurnEntry, isCurrent: boolean): HTMLElement {
  const heading = document.createElement("div");
  heading.className = "turn-heading";
  const name = document.createElement("div");
  name.className = "turn-name";
  name.textContent = isCurrent ? t("activity_current_turn") : formatTurnTime(entry.turn.createdAt);
  const meta = document.createElement("div");
  meta.className = "turn-meta";
  meta.textContent = getTurnSummary(entry.turn, entry.items);
  heading.append(name, meta);
  return heading;
}

function createChevron(expanded: boolean): HTMLElement {
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = expanded ? "⌄" : "›";
  return chevron;
}

function createTurnMark(turn: ToolActivityTurn, items: ToolActivityItem[]): HTMLElement {
  const mark = document.createElement("span");
  mark.className = `mark ${getTurnTone(turn, items)}`;
  mark.textContent = getTurnIcon(turn, items);
  return mark;
}

function createTurnDetails(entry: ToolActivityTurnEntry, nested = false): HTMLElement[] {
  const list = document.createElement("div");
  list.className = nested ? "turn-tool-list" : "list";
  entry.items.forEach((item) => list.appendChild(createActivityRow(item)));

  const footer = document.createElement("div");
  footer.className = `footer ${getTurnTone(entry.turn, entry.items)}`;
  footer.textContent = getDeliveryText(entry.turn, entry.items);
  if (!nested) {return [list, footer];}

  const details = document.createElement("div");
  details.className = "turn-details";
  details.append(list, footer);
  return [details];
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
