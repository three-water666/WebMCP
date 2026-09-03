import { t } from "../modules/i18n";
import { type FollowUpItem, type FollowUpQueue, type FollowUpQueueSnapshot } from "./follow_up_queue";

export interface FollowUpComposerState {
  count: number;
  sending: boolean;
}

type FollowUpStateListener = (state: FollowUpComposerState) => void;

/** Stable follow-up composer embedded in the shared work panel. */
export class FollowUpComposer {
  private readonly confirmButton: HTMLButtonElement;
  public readonly element: HTMLElement;
  private readonly onStateChange: FollowUpStateListener;
  private readonly queueElement: HTMLDivElement;
  private readonly queue: FollowUpQueue;
  private readonly summary: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;

  public constructor(queue: FollowUpQueue, onStateChange: FollowUpStateListener) {
    this.queue = queue;
    this.onStateChange = onStateChange;
    const view = createComposerView();
    this.element = view.element;
    this.queueElement = view.queueElement;
    this.summary = view.summary;
    this.textarea = view.textarea;
    this.confirmButton = view.confirmButton;
    this.bindComposer();
    queue.subscribe((snapshot) => this.renderQueue(snapshot));
  }

  public focusInput(): void {
    this.textarea.focus();
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
    const sending = snapshot.items.some((item) => item.status === "sending");
    this.summary.textContent = sending
      ? t("follow_up_sending")
      : snapshot.items.length > 0
        ? t("follow_up_waiting")
        : t("follow_up_description");
    const count = this.element.querySelector<HTMLElement>(".follow-up-count");
    if (count) {
      count.textContent = String(snapshot.items.length);
      count.style.display = snapshot.items.length > 0 ? "inline-flex" : "none";
    }
    this.onStateChange({ count: snapshot.items.length, sending });
  }

  private createQueueItem(item: FollowUpItem): HTMLElement {
    const row = document.createElement("div");
    row.className = `follow-up-item ${item.status}`;
    const text = document.createElement("div");
    text.className = "follow-up-item-text";
    text.textContent = item.text;
    const actions = document.createElement("div");
    actions.className = "follow-up-item-actions";
    row.append(text, actions);

    const state = document.createElement("span");
    state.className = item.status === "sending"
      ? "follow-up-item-state"
      : "follow-up-item-state waiting";
    state.textContent = t(item.status === "sending" ? "follow_up_sending_short" : "follow_up_waiting_short");
    actions.appendChild(state);
    if (item.status === "confirmed") {
      actions.appendChild(this.createRemoveButton(item.id));
    }
    return row;
  }

  private createRemoveButton(itemId: string): HTMLButtonElement {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "follow-up-remove";
    remove.title = t("follow_up_remove");
    remove.setAttribute("aria-label", remove.title);
    remove.textContent = "×";
    remove.onclick = () => this.queue.remove(itemId);
    return remove;
  }

  private syncConfirmButton(): void {
    this.confirmButton.disabled = this.textarea.value.trim().length === 0;
  }
}

function createComposerView(): {
  confirmButton: HTMLButtonElement;
  element: HTMLElement;
  queueElement: HTMLDivElement;
  summary: HTMLDivElement;
  textarea: HTMLTextAreaElement;
} {
  const element = document.createElement("section");
  element.className = "follow-up-section";
  const header = document.createElement("div");
  header.className = "follow-up-header";
  const heading = document.createElement("div");
  heading.className = "follow-up-heading";
  const title = document.createElement("div");
  title.className = "follow-up-title";
  title.textContent = t("follow_up_title");
  const summary = document.createElement("div");
  summary.className = "follow-up-summary";
  summary.textContent = t("follow_up_description");
  const count = document.createElement("span");
  count.className = "follow-up-count";
  count.style.display = "none";
  heading.append(title, summary);
  header.append(heading, count);

  const queueElement = document.createElement("div");
  queueElement.className = "follow-up-queue";
  const { composer, confirmButton, textarea } = createInputView();
  element.append(header, queueElement, composer);
  return { confirmButton, element, queueElement, summary, textarea };
}

function createInputView(): {
  composer: HTMLDivElement;
  confirmButton: HTMLButtonElement;
  textarea: HTMLTextAreaElement;
} {
  const composer = document.createElement("div");
  composer.className = "follow-up-composer";
  const textarea = document.createElement("textarea");
  textarea.placeholder = t("follow_up_placeholder");
  textarea.setAttribute("aria-label", t("follow_up_title"));
  const footer = document.createElement("div");
  footer.className = "follow-up-composer-footer";
  const hint = document.createElement("span");
  hint.className = "follow-up-hint";
  hint.textContent = t("follow_up_shortcut");
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "follow-up-confirm";
  confirmButton.textContent = t("follow_up_confirm");
  footer.append(hint, confirmButton);
  composer.append(textarea, footer);
  return { composer, confirmButton, textarea };
}
