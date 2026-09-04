import { BRANDING } from "@webcode/shared";
import { t } from "../modules/i18n";
import { FloatingPanelDragController } from "./floating_panel_drag";
import { FollowUpComposer, type FollowUpComposerState } from "./follow_up_overlay";
import { FOLLOW_UP_COMPOSER_STYLE_TEXT } from "./follow_up_overlay_styles";
import type { FollowUpQueue } from "./follow_up_queue";
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
  isTurnSettled,
  type ToolActivityTurnEntry,
} from "./tool_activity_overlay_view";

const ELAPSED_UPDATE_INTERVAL_MS = 1000;

/** Shared floating panel for current tool activity and next-turn follow-ups. */
export class ToolActivityOverlay {
  private readonly activityMount: HTMLDivElement;
  private currentTurnId: string | null = null;
  private dismissedTurnId: string | null = null;
  private readonly dragController: FloatingPanelDragController;
  private enabled = false;
  private expanded = false;
  private readonly followUpComposer: FollowUpComposer;
  private followUpState: FollowUpComposerState = { count: 0, sending: false };
  private readonly headerMount: HTMLDivElement;
  private readonly historyPanel: HTMLDivElement;
  private historyVisible = false;
  private readonly host: HTMLDivElement;
  private readonly launcher: HTMLButtonElement;
  private readonly launcherCount: HTMLSpanElement;
  private readonly launcherLabel: HTMLSpanElement;
  private readonly launcherMark: HTMLSpanElement;
  private latestSnapshot: ToolActivitySnapshot = { items: [], turns: [] };
  private readonly panel: HTMLDivElement;
  private ticker: ReturnType<typeof setInterval> | null = null;

  public constructor(private readonly tracker: ToolActivityTracker, followUpQueue: FollowUpQueue) {
    const view = createOverlayView();
    this.host = view.host;
    this.launcher = view.launcher;
    this.launcherCount = view.launcherCount;
    this.launcherLabel = view.launcherLabel;
    this.launcherMark = view.launcherMark;
    this.historyPanel = view.historyPanel;
    this.panel = view.panel;
    this.headerMount = view.headerMount;
    this.activityMount = view.activityMount;
    this.dragController = new FloatingPanelDragController(this.host);
    this.dragController.bindHandle(this.launcher, true);
    this.bindLauncher();
    this.followUpComposer = new FollowUpComposer(followUpQueue,
      (state) => this.handleFollowUpState(state));
    this.panel.appendChild(this.followUpComposer.element);
    this.tracker.subscribe((snapshot) => this.render(snapshot));
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {return;}
    this.enabled = enabled;
    if (!enabled) {this.expanded = false; this.historyVisible = false;}
    this.render(this.latestSnapshot);
  }

  private bindLauncher(): void {
    this.launcher.onclick = () => {
      if (!this.dragController.consumeDragClick()) {this.setExpanded(true);}
    };
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.render(this.latestSnapshot);
    if (expanded) {this.followUpComposer.focusInput();}
  }

  private handleFollowUpState(state: FollowUpComposerState): void {
    this.followUpState = state;
    this.render(this.latestSnapshot);
  }

  private render(snapshot: ToolActivitySnapshot): void {
    this.latestSnapshot = snapshot;
    const entries = getActivityTurnEntries(snapshot);
    const latestEntry = entries.at(-1);
    const isSameTurn = latestEntry?.turn.id === this.currentTurnId;
    const currentScrollTop = isSameTurn ? this.getCurrentScrollTop() : 0;
    const historyScrollTop = this.getHistoryScrollTop();
    if (latestEntry && !isSameTurn) {this.startTurn(latestEntry.turn.id);}
    if (!latestEntry) {this.currentTurnId = null; this.dismissedTurnId = null;}

    const currentEntry = latestEntry && latestEntry.turn.id !== this.dismissedTurnId
      ? latestEntry
      : undefined;
    const historyEntries = currentEntry ? entries.slice(0, -1) : entries;
    this.renderCurrent(currentEntry, historyEntries.length);
    this.renderHistory(historyEntries, currentEntry?.turn.id);
    this.restoreCurrentScrollTop(currentScrollTop);
    this.restoreHistoryScrollTop(historyScrollTop);
    this.syncVisibility(Boolean(currentEntry));
    this.syncTicker(Boolean(currentEntry?.items.some((item) => item.status === "executing")));
    this.dragController.scheduleClamp();
  }

  private renderCurrent(entry: ToolActivityTurnEntry | undefined, historyCount: number): void {
    this.host.className = this.expanded ? "work-panel-expanded" : "";
    this.launcher.setAttribute("aria-expanded", String(this.expanded));
    this.headerMount.replaceChildren(this.createCurrentHeader(entry, historyCount));
    this.activityMount.replaceChildren(...(entry ? createTurnDetails(entry, "list") : []));
    this.activityMount.style.display = entry ? "flex" : "none";
    this.updateLauncher(entry);
  }

  private renderHistory(entries: ToolActivityTurnEntry[], currentTurnId?: string): void {
    const shouldShow = this.expanded && this.historyVisible;
    this.historyPanel.style.display = shouldShow ? "flex" : "none";
    if (!shouldShow) {return;}

    const header = document.createElement("div");
    header.className = "history-header drag-header";
    header.title = t("work_panel_drag");
    this.dragController.bindHandle(header);
    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = `${t("activity_history")} · ${entries.length}`;
    const actions = document.createElement("div");
    actions.className = "history-actions";
    actions.append(this.createHistoryClearButton(entries.length, currentTurnId), this.createHistoryCloseButton());
    header.append(title, actions);

    const list = document.createElement("div");
    list.className = "history-list";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty"; empty.textContent = t("activity_no_history");
      list.appendChild(empty);
    } else {
      entries.forEach((entry) => list.appendChild(createHistoryTurn(entry)));
    }
    this.historyPanel.replaceChildren(header, list);
  }

  private createCurrentHeader(
    entry: ToolActivityTurnEntry | undefined, historyCount: number
  ): HTMLElement {
    const header = document.createElement("div");
    header.className = "header drag-header";
    header.title = t("work_panel_drag");
    this.dragController.bindHandle(header);

    const identity = document.createElement("div");
    identity.className = "identity";
    const heading = document.createElement("div");
    heading.className = "heading";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `${BRANDING.productName} · ${t("work_panel_title")}`;
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = this.getPanelSummary(entry);
    heading.append(title, summary);
    identity.append(entry ? createTurnMark(entry.turn, entry.items) : createIdleMark(), heading);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(this.createHistoryButton(historyCount), this.createCollapseButton(),
      this.createCloseButton(entry));
    header.append(identity, actions);
    return header;
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

  private createHistoryCloseButton(): HTMLButtonElement {
    const button = createIconButton("×", t("activity_hide_history"), "icon-button close");
    button.onclick = () => {this.historyVisible = false; this.render(this.latestSnapshot);};
    return button;
  }

  private createHistoryClearButton(historyCount: number, currentTurnId?: string): HTMLButtonElement {
    const button = createIconButton(t("activity_clear"), t("activity_clear_history"),
      "history-clear-button");
    button.disabled = historyCount === 0;
    button.onclick = button.disabled ? null : () => this.tracker.clearHistory(currentTurnId);
    return button;
  }

  private createCollapseButton(): HTMLButtonElement {
    const button = createIconButton("−", t("activity_minimize"), "icon-button collapse");
    button.onclick = () => this.setExpanded(false);
    return button;
  }

  private createCloseButton(entry: ToolActivityTurnEntry | undefined): HTMLButtonElement {
    const button = createIconButton("×", t("activity_close"), "icon-button close");
    const turnId = entry && isTurnSettled(entry.turn) ? entry.turn.id : null;
    button.disabled = turnId === null;
    button.onclick = turnId === null ? null : () => {
      this.dismissedTurnId = turnId;
      this.render(this.latestSnapshot);
    };
    return button;
  }

  private getPanelSummary(entry: ToolActivityTurnEntry | undefined): string {
    if (entry) {return getTurnSummary(entry.turn, entry.items);}
    if (this.followUpState.sending) {return t("follow_up_sending");}
    if (this.followUpState.count > 0) {return t("follow_up_waiting");}
    return t("follow_up_description");
  }

  private updateLauncher(entry: ToolActivityTurnEntry | undefined): void {
    this.launcherMark.className = entry
      ? `launcher-mark ${getTurnTone(entry.turn, entry.items)}`
      : "launcher-mark idle";
    this.launcherMark.textContent = entry ? getTurnIcon(entry.turn, entry.items) : "+";
    this.launcherLabel.textContent = entry
      ? getTurnSummary(entry.turn, entry.items)
      : t("follow_up_title");
    this.launcherCount.textContent = String(this.followUpState.count);
    this.launcherCount.style.display = this.followUpState.count > 0 ? "inline-flex" : "none";
  }

  private startTurn(turnId: string): void {
    this.currentTurnId = turnId;
    this.dismissedTurnId = null;
  }

  private syncVisibility(hasCurrentActivity: boolean): void {
    this.host.style.display = this.enabled || hasCurrentActivity ? "block" : "none";
  }

  private syncTicker(shouldRun: boolean): void {
    if (shouldRun && !this.ticker) {
      this.ticker = setInterval(() => this.render(this.latestSnapshot), ELAPSED_UPDATE_INTERVAL_MS);
    } else if (!shouldRun && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private getCurrentScrollTop(): number {
    return this.activityMount.querySelector<HTMLElement>(".list")?.scrollTop ?? 0;
  }

  private getHistoryScrollTop(): number {
    if (!this.historyVisible) {return 0;}
    return this.historyPanel.querySelector<HTMLElement>(".history-list")?.scrollTop ?? 0;
  }

  private restoreCurrentScrollTop(scrollTop: number): void {
    const list = this.activityMount.querySelector<HTMLElement>(".list");
    if (list) {list.scrollTop = scrollTop;}
  }

  private restoreHistoryScrollTop(scrollTop: number): void {
    if (!this.historyVisible) {return;}
    const history = this.historyPanel.querySelector<HTMLElement>(".history-list");
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
  return createMark(`mark ${getTurnTone(turn, items)}`, getTurnIcon(turn, items));
}

function createMark(className: string, text: string): HTMLElement {
  const mark = document.createElement("span");
  mark.className = className;
  mark.textContent = text;
  return mark;
}

function createIdleMark(): HTMLElement {
  return createMark("mark idle", "+");
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
  const source = document.createElement("span");
  source.className = `source-badge ${item.source}`;
  source.textContent = t(item.source === "network" ? "activity_source_network" : "activity_source_dom");
  const identity = document.createElement("div");
  identity.className = "tool-identity";
  identity.append(name, source);
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = getItemStatusText(item);
  top.append(identity, status);
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

function createIconButton(text: string, title: string, className = "icon-button"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = text;
  return button;
}

interface OverlayView {
  activityMount: HTMLDivElement;
  headerMount: HTMLDivElement;
  historyPanel: HTMLDivElement;
  host: HTMLDivElement;
  launcher: HTMLButtonElement;
  launcherCount: HTMLSpanElement;
  launcherLabel: HTMLSpanElement;
  launcherMark: HTMLSpanElement;
  panel: HTMLDivElement;
}

function createOverlayView(): OverlayView {
  const host = document.createElement("div");
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${TOOL_ACTIVITY_STYLE_TEXT}\n${FOLLOW_UP_COMPOSER_STYLE_TEXT}`;
  const launcherView = createLauncherView();
  const stack = document.createElement("div");
  stack.className = "overlay-stack";
  const historyPanel = document.createElement("div");
  historyPanel.className = "history-panel";
  historyPanel.style.display = "none";
  const panel = document.createElement("div");
  panel.className = "panel";
  const headerMount = document.createElement("div");
  headerMount.className = "header-mount";
  const activityMount = document.createElement("div");
  activityMount.className = "activity-mount";
  panel.append(headerMount, activityMount);
  stack.append(historyPanel, panel);
  shadow.append(style, launcherView.launcher, stack);
  document.body.appendChild(host);
  return { activityMount, headerMount, historyPanel, host, panel, ...launcherView };
}

function createLauncherView(): Pick<
  OverlayView,
  "launcher" | "launcherCount" | "launcherLabel" | "launcherMark"
> {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "launcher";
  launcher.title = t("work_panel_open");
  launcher.setAttribute("aria-label", launcher.title);
  launcher.setAttribute("aria-expanded", "false");
  const launcherMark = document.createElement("span");
  launcherMark.className = "launcher-mark idle";
  launcherMark.textContent = "+";
  const launcherLabel = document.createElement("span");
  launcherLabel.className = "launcher-label";
  launcherLabel.textContent = t("follow_up_title");
  const launcherCount = document.createElement("span");
  launcherCount.className = "launcher-count";
  launcherCount.style.display = "none";
  launcher.append(launcherMark, launcherLabel, launcherCount);
  return { launcher, launcherCount, launcherLabel, launcherMark };
}
