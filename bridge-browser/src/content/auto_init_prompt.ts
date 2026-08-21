import { BRANDING, type ToolProtocolFormat } from "@webcode/shared";
import type { SiteSelectors } from "../modules/config";
import { i18n } from "../modules/i18n";
import { Logger } from "../modules/logger";
import { getMessageBlockElements } from "../modules/page_selectors";
import { pasteTextAsAttachment } from "../modules/result_delivery";
import { buildInitToolCallPrompt } from "../modules/toolProtocolFormatting";
import * as UI from "../modules/ui";
import {
  type AutoInitPromptMode,
  buildOversizedInitPromptNotice,
  buildReplacementForContext,
  findAutoInitTrigger,
  getMaxInlineChars,
  hasInitializationContextMarker,
} from "./auto_init_prompt_text";
import { buildWebcodeInitPrompt } from "./init_context";

interface AutoInitPromptControllerOptions {
  getSelectors: () => SiteSelectors | null;
  getSiteId: () => string | null;
  getToolProtocol: () => ToolProtocolFormat;
  isClientConnected: () => boolean;
  loadPromptsFromStorage: () => Promise<void>;
}

interface AutoInitPromptContext {
  inputEl: HTMLElement;
  currentText: string;
  initPrompt: string;
  mode: AutoInitPromptMode;
}

interface AutoInitPromptResult {
  success: boolean;
  attached?: boolean;
  error?: string;
}

interface AutoInitPromptReplacement {
  text: string;
  attached: boolean;
}

type AutoInitPromptCandidate = Omit<AutoInitPromptContext, "initPrompt">;

const AUTO_INIT_CHECK_DELAYS_MS = [0, 50, 150, 350];
const AUTO_INIT_EVENT_TYPES = [
  "beforeinput",
  "input",
  "keyup",
  "paste",
  "compositionend",
  "change",
  "focusin",
] as const;
const AUTO_INIT_ATTACHMENT_FILENAME_PREFIX = `${BRANDING.slug}-init-context`;

export class AutoInitPromptController {
  private listenerStarted = false;
  private modalOpen = false;
  private lastPromptedText = "";
  private lastObservedUrl = location.href;

  public constructor(private readonly options: AutoInitPromptControllerOptions) {}

  public setupTrigger(): void {
    if (this.listenerStarted) {return;}
    this.listenerStarted = true;

    for (const eventType of AUTO_INIT_EVENT_TYPES) {
      document.addEventListener(eventType, () => this.scheduleCheck(), true);
    }
    document.addEventListener("keydown", (event) => this.handleKeyDown(event), true);
    document.addEventListener("click", (event) => this.handleClick(event), true);
  }

  public scheduleCheck(): void {
    for (const delay of AUTO_INIT_CHECK_DELAYS_MS) {
      setTimeout(() => {
        this.refreshPromptDedupState();
        void this.maybePromptAutoInit();
      }, delay);
    }
  }

  public async appendManualInitPrompt(): Promise<AutoInitPromptResult> {
    const candidate = this.getManualPromptCandidate();
    if (!candidate) {
      return { success: false, error: "Input box not found or webcode is not connected." };
    }

    const initPrompt = await this.buildDirectInitPrompt();
    if (!initPrompt) {
      return { success: false, error: "Initialization prompt is unavailable." };
    }

    return this.insertInitPrompt({
      ...candidate,
      initPrompt,
    });
  }

  private refreshPromptDedupState(): void {
    const currentUrl = location.href;
    if (currentUrl !== this.lastObservedUrl) {
      this.lastObservedUrl = currentUrl;
      this.lastPromptedText = "";
      return;
    }

    const selectors = this.options.getSelectors();
    if (!selectors) {return;}
    if (hasVisibleMessageBlock(selectors)) {
      this.lastPromptedText = "";
      return;
    }

    const inputEl = this.findCurrentInputElement(false);
    if (inputEl && !getInputText(inputEl).trim()) {
      this.lastPromptedText = "";
    }
  }

  private async maybePromptAutoInit(): Promise<void> {
    const candidate = this.getTriggeredPromptCandidate(true);
    if (!candidate) {return;}

    if (!await this.loadInitPrompt()) {return;}

    await this.promptAndMaybeInsert(candidate);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!isEnterSendIntent(event)) {return;}
    this.maybePromptBeforeSend(event, true);
  }

  private handleClick(event: MouseEvent): void {
    if (!isPrimaryClick(event)) {return;}

    const selectors = this.options.getSelectors();
    if (!selectors || !isSendButtonEvent(event, selectors.sendButton)) {return;}

    this.maybePromptBeforeSend(event, false);
  }

  private maybePromptBeforeSend(event: Event, requireActiveInput: boolean): void {
    const candidate = this.getTriggeredPromptCandidate(requireActiveInput) ??
      this.getForgottenPromptCandidate(requireActiveInput);
    if (!candidate) {return;}

    if (!this.getLoadedInitPrompt()) {
      void this.loadInitPrompt();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void this.promptAndMaybeInsert(candidate);
  }

  private async promptAndMaybeInsert(candidate: AutoInitPromptCandidate): Promise<void> {
    this.lastPromptedText = candidate.currentText;
    this.modalOpen = true;

    try {
      const confirmed = await UI.showAutoInitConfirm();
      if (!confirmed) {return;}

      const initPrompt = await this.buildDirectInitPrompt();
      if (!initPrompt) {return;}

      await this.insertInitPrompt({
        ...candidate,
        initPrompt,
      });
    } finally {
      this.modalOpen = false;
    }
  }

  private getTriggeredPromptCandidate(requireActiveInput: boolean): AutoInitPromptCandidate | null {
    const selectors = this.options.getSelectors();
    if (!selectors || !this.options.isClientConnected() || this.modalOpen) {
      return null;
    }
    if (!isPristineConversation(selectors)) {return null;}

    const inputEl = this.findCurrentInputElement(requireActiveInput);
    if (!inputEl) {return null;}

    const currentText = getInputText(inputEl);
    if (!findAutoInitTrigger(currentText)) {return null;}
    if (currentText === this.lastPromptedText) {return null;}

    return {
      inputEl,
      currentText,
      mode: "replace-trigger",
    };
  }

  private getForgottenPromptCandidate(requireActiveInput: boolean): AutoInitPromptCandidate | null {
    const selectors = this.options.getSelectors();
    if (!selectors || !this.options.isClientConnected() || this.modalOpen) {
      return null;
    }
    if (!isPristineConversation(selectors)) {return null;}

    const inputEl = this.findCurrentInputElement(requireActiveInput);
    if (!inputEl) {return null;}

    const currentText = getInputText(inputEl);
    if (!currentText.trim()) {return null;}
    if (currentText === this.lastPromptedText) {return null;}
    if (findAutoInitTrigger(currentText)) {return null;}
    if (hasInitializationContextMarker(currentText)) {return null;}

    return {
      inputEl,
      currentText,
      mode: "append-forgotten",
    };
  }

  private getManualPromptCandidate(): AutoInitPromptCandidate | null {
    const selectors = this.options.getSelectors();
    if (!selectors || !this.options.isClientConnected() || this.modalOpen) {
      return null;
    }

    const inputEl = this.findCurrentInputElement(false);
    if (!inputEl) {return null;}

    return {
      inputEl,
      currentText: getInputText(inputEl),
      mode: "append-manual",
    };
  }

  private getLoadedInitPrompt(): string | null {
    if (this.options.getToolProtocol() === "xml") {
      return buildInitToolCallPrompt("xml", i18n.lang);
    }
    return i18n.resources.init ?? null;
  }

  private async loadInitPrompt(): Promise<string | null> {
    if (!i18n.resources.init) {
      try {
        await this.options.loadPromptsFromStorage();
      } catch (error) {
        Logger.log(`Initialization prompt load failed: ${getErrorMessage(error)}`, "error");
        return null;
      }
    }
    return this.getLoadedInitPrompt();
  }

  private async buildDirectInitPrompt(): Promise<string | null> {
    const fallbackInitPrompt = await this.loadInitPrompt();
    if (!fallbackInitPrompt) {return null;}

    try {
      return await buildWebcodeInitPrompt({
        includeInitToolResultHeader: false,
        siteId: this.options.getSiteId(),
        toolProtocol: this.options.getToolProtocol(),
      });
    } catch (error) {
      Logger.log(`Direct initialization prompt build failed: ${getErrorMessage(error)}`, "error");
      return fallbackInitPrompt;
    }
  }

  private async insertInitPrompt(context: AutoInitPromptContext): Promise<AutoInitPromptResult> {
    const selectors = this.options.getSelectors();
    if (!selectors) {
      return { success: false, error: "Site selectors are unavailable." };
    }

    const latestInput = context.inputEl.isConnected
      ? context.inputEl
      : this.findCurrentInputElement(false);
    if (!latestInput) {
      return { success: false, error: "Input box not found." };
    }

    const latestText = getInputText(latestInput);
    if (hasInitializationContextMarker(latestText)) {
      return { success: true, attached: false };
    }

    const replacement = await this.buildReplacementForCurrentInput(context, latestText, selectors);
    if (!replacement) {
      return { success: false, error: "Initialization replacement is unavailable." };
    }

    if (UI.replaceInputBoxText(replacement.text, selectors.inputArea)) {
      this.lastPromptedText = replacement.text;
      Logger.log("Inserted webcode initialization prompt", "action");
      return { success: true, attached: replacement.attached };
    }

    return { success: false, error: "Input box not found." };
  }

  private findCurrentInputElement(requireActive: boolean): HTMLElement | null {
    const selectors = this.options.getSelectors();
    if (!selectors) {return null;}

    const candidates = UI.getInputAreaCandidates(selectors);
    if (candidates.length === 0) {return null;}

    const activeInput = candidates.find((candidate) => isActiveInput(candidate));
    if (activeInput) {return activeInput;}

    if (requireActive) {return null;}
    return candidates.find((candidate) => isVisibleElement(candidate)) ?? candidates[0] ?? null;
  }

  private async buildReplacementForCurrentInput(
    context: AutoInitPromptContext,
    latestText: string,
    selectors: SiteSelectors
  ): Promise<AutoInitPromptReplacement | null> {
    const replacement = buildReplacementForContext(context.mode, latestText, context.initPrompt);
    if (!replacement) {return null;}

    const maxInlineChars = getMaxInlineChars(selectors);
    if (!maxInlineChars || replacement.length <= maxInlineChars) {
      return { text: replacement, attached: false };
    }

    const uploaded = await pasteTextAsAttachment(
      context.initPrompt,
      selectors,
      AUTO_INIT_ATTACHMENT_FILENAME_PREFIX
    );

    if (uploaded) {
      Logger.log(`Attached oversized ${BRANDING.productName} initialization context`, "action");
      const noticeReplacement = buildReplacementForContext(
        context.mode,
        latestText,
        buildOversizedInitPromptNotice()
      );
      return noticeReplacement ? { text: noticeReplacement, attached: true } : null;
    }

    Logger.log("Initialization context attachment failed. Falling back to the webcode_init command prompt.", "warn");
    const fallbackInitPrompt = this.getLoadedInitPrompt();
    if (!fallbackInitPrompt) {return null;}
    const fallbackReplacement = buildReplacementForContext(
      context.mode,
      latestText,
      fallbackInitPrompt
    );
    return fallbackReplacement ? { text: fallbackReplacement, attached: false } : null;
  }
}

function isEnterSendIntent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {return false;}
  if (event.key !== "Enter") {return false;}
  if (event.isComposing) {return false;}
  return !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

function isPrimaryClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0;
}

function isSendButtonEvent(event: MouseEvent, sendButtonSelector: string): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {return false;}

  try {
    return Boolean(target.closest(sendButtonSelector));
  } catch {
    return false;
  }
}

function isActiveInput(inputEl: HTMLElement): boolean {
  const activeEl = document.activeElement;
  return activeEl === inputEl || Boolean(activeEl) && inputEl.contains(activeEl);
}

function getInputText(inputEl: HTMLElement | HTMLInputElement | HTMLTextAreaElement): string {
  if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
    return inputEl.value;
  }
  return inputEl.innerText ?? inputEl.textContent ?? "";
}

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {return false;}

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function hasVisibleMessageBlock(selectors: SiteSelectors): boolean {
  try {
    return getMessageBlockElements<HTMLElement>(selectors)
      .some((element) => isVisibleElement(element));
  } catch {
    return true;
  }
}

function isPristineConversation(selectors: SiteSelectors): boolean {
  if (UI.isStopButtonVisible(selectors)) {return false;}
  return !hasVisibleMessageBlock(selectors);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
