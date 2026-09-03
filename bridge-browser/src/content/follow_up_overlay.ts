import { BRANDING } from "@webcode/shared";
import { t } from "../modules/i18n";
import { FloatingPanelDragController } from "./floating_panel_drag";
import { type FollowUpItem, type FollowUpQueue, type FollowUpQueueSnapshot } from "./follow_up_queue";
import { FOLLOW_UP_OVERLAY_STYLE_TEXT } from "./follow_up_overlay_styles";
import { isTurnSettled } from "./tool_activity_overlay_view";
import { type ToolActivitySnapshot, type ToolActivityTracker } from "./tool_activity";

/** Floating composer for follow-ups that are safe to include in the next automatic turn. */
export class FollowUpOverlay {
  private enabled = true;
  private readonly confirmButton: HTMLButtonElement;
  private readonly dragController: FloatingPanelDragController;
  private generating = false;
  private readonly host: HTMLDivElement;
  private readonly queueElement: HTMLDivElement;
  private queueSending = false;
  private readonly queue: FollowUpQueue;
  private readonly summary: HTMLDivElement;
  private toolWorking = false;
  private readonly textarea: HTMLTextAreaElement;

  public constructor(queue: FollowUpQueue, tracker: ToolActivityTracker) {
    this.queue = queue;
    const view = createOverlayView();
    this.host = view.host;
    this.queueElement = view.queueElement;
    this.summary = view.summary;
    this.textarea = view.textarea;
    this.confirmButton = view.confirmButton;

    this.dragController = new FloatingPanelDragController(this.host);
    this.dragController.bindHandle(view.header);
    this.bindComposer();
    queue.subscribe((snapshot) => this.renderQueue(snapshot));
    tracker.subscribe((snapshot) => this.updateToolWorking(snapshot));
  }

  public setGenerating(generating: boolean): void {
    this.generating = generating;
    this.syncVisibility();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncVisibility();
  }

  private bindComposer(): void {
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

  private confirmDraft(): void {
    if (!this.queue.confirm(this.textarea.value)) {return;}
    this.textarea.value = "";
    this.syncConfirmButton();
    this.textarea.focus();
  }

  private renderQueue(snapshot: FollowUpQueueSnapshot): void {
    this.queueElement.replaceChildren(...snapshot.items.map((item) => this.createQueueItem(item)));
    const sendingCount = snapshot.items.filter((item) => item.status === "sending").length;
    this.queueSending = sendingCount > 0;
    this.summary.textContent = sendingCount > 0
      ? t("follow_up_sending")
      : t("follow_up_description");
    const count = this.host.shadowRoot?.querySelector<HTMLElement>(".count");
    if (count) {
      count.textContent = String(snapshot.items.length);
      count.style.display = snapshot.items.length > 0 ? "block" : "none";
    }
    this.syncVisibility();
    this.dragController.scheduleClamp();
  }

  private createQueueItem(item: FollowUpItem): HTMLElement {
    const row = document.createElement("div");
    row.className = `item ${item.status}`;
    const text = document.createElement("div");
    text.className = "item-text";
    text.textContent = item.text;
    row.appendChild(text);

    if (item.status === "sending") {
      const state = document.createElement("span");
      state.className = "item-state";
      state.textContent = t("follow_up_sending_short");
      row.appendChild(state);
    } else {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.title = t("follow_up_remove");
      remove.setAttribute("aria-label", remove.title);
      remove.textContent = "×";
      remove.onclick = () => this.queue.remove(item.id);
      row.appendChild(remove);
    }
    return row;
  }

  private updateToolWorking(snapshot: ToolActivitySnapshot): void {
    const currentTurn = snapshot.turns.at(-1);
    this.toolWorking = Boolean(currentTurn && !isTurnSettled(currentTurn));
    this.syncVisibility();
  }

  private syncConfirmButton(): void {
    this.confirmButton.disabled = this.textarea.value.trim().length === 0;
  }

  private syncVisibility(): void {
    const working = this.generating || this.toolWorking || this.queueSending;
    this.host.style.display = this.enabled && working ? "block" : "none";
  }
}

function createOverlayView(): {
  confirmButton: HTMLButtonElement;
  header: HTMLDivElement;
  host: HTMLDivElement;
  queueElement: HTMLDivElement;
  summary: HTMLDivElement;
  textarea: HTMLTextAreaElement;
} {
  const host = document.createElement("div");
  host.style.display = "none";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = FOLLOW_UP_OVERLAY_STYLE_TEXT;

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
  heading.append(title, summary);
  header.append(heading, count);

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
  shadow.append(style, panel);
  document.body.appendChild(host);
  return { confirmButton, header, host, queueElement, summary, textarea };
}
