import { BRANDING } from "@webcode/shared";
import { t } from "../modules/i18n";
import { FloatingPanelDragController } from "./floating_panel_drag";
import { type FollowUpItem, type FollowUpQueue, type FollowUpQueueSnapshot } from "./follow_up_queue";
import { FOLLOW_UP_OVERLAY_STYLE_TEXT } from "./follow_up_overlay_styles";

/** Persistent compact launcher and composer for next-turn follow-ups. */
export class FollowUpOverlay {
  private readonly collapseButton: HTMLButtonElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly dragController: FloatingPanelDragController;
  private enabled = false;
  private readonly host: HTMLDivElement;
  private readonly launcher: HTMLButtonElement;
  private readonly launcherCount: HTMLSpanElement;
  private readonly queueElement: HTMLDivElement;
  private queueSending = false;
  private readonly queue: FollowUpQueue;
  private readonly summary: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;

  public constructor(queue: FollowUpQueue) {
    this.queue = queue;
    const view = createOverlayView();
    this.host = view.host;
    this.launcher = view.launcher;
    this.launcherCount = view.launcherCount;
    this.queueElement = view.queueElement;
    this.summary = view.summary;
    this.textarea = view.textarea;
    this.collapseButton = view.collapseButton;
    this.confirmButton = view.confirmButton;

    this.dragController = new FloatingPanelDragController(this.host);
    this.dragController.bindHandle(view.header);
    this.dragController.bindHandle(view.launcher, true);
    this.bindComposer();
    queue.subscribe((snapshot) => this.renderQueue(snapshot));
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {this.setExpanded(false);}
    this.syncVisibility();
  }

  private bindComposer(): void {
    this.launcher.onclick = () => {
      if (!this.dragController.consumeDragClick()) {this.setExpanded(true);}
    };
    this.collapseButton.onclick = () => this.setExpanded(false);
    this.confirmButton.onclick = () => this.confirmDraft();
    this.textarea.addEventListener("input", () => this.syncConfirmButton());
    this.textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        this.confirmDraft();
      }
    });
    this.textarea.addEventListener("keypress", (event) => event.stopPropagation());
    this.textarea.addEventListener("keyup", (event) => event.stopPropagation());
    this.syncConfirmButton();
  }

  private setExpanded(expanded: boolean): void {
    this.host.className = expanded ? "webcode-follow-up-expanded" : "";
    this.launcher.setAttribute("aria-expanded", String(expanded));
    if (expanded) {this.textarea.focus();}
    this.dragController.scheduleClamp();
  }

  private confirmDraft(): void {
    if (!this.queue.confirm(this.textarea.value)) {return;}
    this.textarea.value = "";
    this.syncConfirmButton();
    this.textarea.focus();
  }

  private renderQueue(snapshot: FollowUpQueueSnapshot): void {
    const wasSending = this.queueSending;
    this.queueElement.replaceChildren(...snapshot.items.map((item) => this.createQueueItem(item)));
    const sendingCount = snapshot.items.filter((item) => item.status === "sending").length;
    this.queueSending = sendingCount > 0;
    this.summary.textContent = sendingCount > 0
      ? t("follow_up_sending")
      : snapshot.items.length > 0
        ? t("follow_up_waiting")
        : t("follow_up_description");
    const count = this.host.shadowRoot?.querySelector<HTMLElement>(".count");
    if (count) {
      count.textContent = String(snapshot.items.length);
      count.style.display = snapshot.items.length > 0 ? "block" : "none";
    }
    this.launcherCount.textContent = String(snapshot.items.length);
    this.launcherCount.style.display = snapshot.items.length > 0 ? "inline-flex" : "none";
    if (wasSending && snapshot.items.length === 0) {this.setExpanded(false);}
    this.syncVisibility();
    this.dragController.scheduleClamp();
  }

  private createQueueItem(item: FollowUpItem): HTMLElement {
    const row = document.createElement("div");
    row.className = `item ${item.status}`;
    const text = document.createElement("div");
    text.className = "item-text";
    text.textContent = item.text;
    const actions = document.createElement("div");
    actions.className = "item-actions";
    row.append(text, actions);

    if (item.status === "sending") {
      const state = document.createElement("span");
      state.className = "item-state";
      state.textContent = t("follow_up_sending_short");
      actions.appendChild(state);
    } else {
      const state = document.createElement("span");
      state.className = "item-state waiting";
      state.textContent = t("follow_up_waiting_short");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.title = t("follow_up_remove");
      remove.setAttribute("aria-label", remove.title);
      remove.textContent = "×";
      remove.onclick = () => this.queue.remove(item.id);
      actions.append(state, remove);
    }
    return row;
  }

  private syncConfirmButton(): void {
    this.confirmButton.disabled = this.textarea.value.trim().length === 0;
  }

  private syncVisibility(): void {
    this.host.style.display = this.enabled ? "block" : "none";
  }
}

function createOverlayView(): {
  collapseButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
  header: HTMLDivElement;
  host: HTMLDivElement;
  launcher: HTMLButtonElement;
  launcherCount: HTMLSpanElement;
  queueElement: HTMLDivElement;
  summary: HTMLDivElement;
  textarea: HTMLTextAreaElement;
} {
  const host = document.createElement("div");
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = FOLLOW_UP_OVERLAY_STYLE_TEXT;

  const { launcher, launcherCount } = createLauncherView();

  const panel = document.createElement("section");
  panel.className = "panel";
  const header = document.createElement("div");
  header.className = "header";
  header.title = t("follow_up_drag");
  const heading = document.createElement("div");
  heading.className = "heading";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = `${BRANDING.productName} · ${t("follow_up_title")}`;
  const summary = document.createElement("div");
  summary.className = "summary";
  summary.textContent = t("follow_up_description");
  const count = document.createElement("span");
  count.className = "count";
  count.style.display = "none";
  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "collapse";
  collapseButton.title = t("follow_up_collapse");
  collapseButton.setAttribute("aria-label", collapseButton.title);
  collapseButton.textContent = "−";
  heading.append(title, summary);
  header.append(heading, count, collapseButton);

  const body = document.createElement("div");
  body.className = "body";
  const queueElement = document.createElement("div");
  queueElement.className = "queue";
  const composer = document.createElement("div");
  composer.className = "composer";
  const textarea = document.createElement("textarea");
  textarea.placeholder = t("follow_up_placeholder");
  textarea.setAttribute("aria-label", t("follow_up_title"));
  const footer = document.createElement("div");
  footer.className = "composer-footer";
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = t("follow_up_shortcut");
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "confirm";
  confirmButton.textContent = t("follow_up_confirm");
  footer.append(hint, confirmButton);
  composer.append(textarea, footer);
  body.append(queueElement, composer);
  panel.append(header, body);
  shadow.append(style, launcher, panel);
  document.body.appendChild(host);
  return {
    collapseButton,
    confirmButton,
    header,
    host,
    launcher,
    launcherCount,
    queueElement,
    summary,
    textarea,
  };
}

function createLauncherView(): {
  launcher: HTMLButtonElement;
  launcherCount: HTMLSpanElement;
} {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "launcher";
  launcher.title = t("follow_up_open");
  launcher.setAttribute("aria-label", launcher.title);
  launcher.setAttribute("aria-expanded", "false");
  const mark = document.createElement("span");
  mark.className = "launcher-mark";
  mark.textContent = "+";
  const label = document.createElement("span");
  label.className = "launcher-label";
  label.textContent = t("follow_up_title");
  const launcherCount = document.createElement("span");
  launcherCount.className = "launcher-count";
  launcherCount.style.display = "none";
  launcher.append(mark, label, launcherCount);
  return { launcher, launcherCount };
}
