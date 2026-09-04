import { type ToolExecutionPayload } from "../types";
import {
  getCommandExecutable,
  getCommandApprovalContext,
  getCommandPrefix,
  isCommandApprovalScopeAllowed,
  isBroadCommandExecutable,
  normalizeCommandValue,
  type CommandApprovalScope,
} from "./command_approval";
import { isElementVisible } from "./dom_helpers";
import { t } from "./i18n";
import { APPROVAL_MODAL_Z_INDEX } from "./overlay_layers";
import {
  clearUserAttention,
  showUserAttentionNotification,
} from "./user_attention";
import {
  APPROVAL_MODAL_STYLE,
  escapeHtml,
  renderApprovalModalHtml,
  renderCommandApprovalOptions,
  type ApprovalModalContent,
} from "./approval_modal_markup";

type ModalCallbacks = {
  onConfirm: (scope: CommandApprovalScope) => void;
  onReject: (reason: string) => void;
};

export type ApprovalModalOptions = {
  mandatory?: boolean;
  riskReasons?: string[];
};

type ModalElements = {
  viewMain: HTMLElement;
  viewAlways: HTMLElement;
  btnAlways: HTMLButtonElement;
  btnBack: HTMLButtonElement;
  btnReject: HTMLButtonElement;
  btnConfirm: HTMLButtonElement;
  btnConfirmAlways: HTMLButtonElement;
  inputReason: HTMLInputElement;
  btnAllowExact: HTMLButtonElement | null;
  btnAllowExecutable: HTMLButtonElement | null;
  btnAllowPrefix: HTMLButtonElement | null;
};

type ModalState = {
  rejectStep: number;
};

type CommandApprovalDetails = {
  commandValue: string;
  exactKey: string;
  executableKey: string;
  isBroadExecutable: boolean;
  isCommandScopedApproval: boolean;
  prefixKey: string;
};

const MODAL_EVENT_GUARD_TYPES = [
  "beforeinput",
  "change",
  "click",
  "compositionend",
  "compositionstart",
  "compositionupdate",
  "contextmenu",
  "cut",
  "dblclick",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mouseup",
  "paste",
  "pointerdown",
  "pointerup",
  "touchend",
  "touchstart",
];
const MODAL_FOCUS_RESTORE_TYPES = [
  "beforeinput",
  "compositionstart",
  "compositionupdate",
  "keydown",
  "keypress",
  "paste",
];

function installModalEventGuards(
  host: HTMLElement,
  shadow: ShadowRoot,
  getFocusTarget?: (event: Event) => HTMLElement | null
): () => void {
  const cleanupCallbacks: Array<() => void> = [];
  const addGuard = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean
  ) => {
    target.addEventListener(type, listener, options);
    cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
  };

  const restoreModalFocus = (event: Event) => {
    const focusTarget = getFocusTarget?.(event);
    if (!focusTarget || !isElementVisible(focusTarget)) {return;}
    if (shadow.activeElement === focusTarget) {return;}
    focusTarget.focus({ preventScroll: true });
  };

  const stopPagePropagation = (event: Event) => {
    event.stopPropagation();
  };

  for (const type of MODAL_FOCUS_RESTORE_TYPES) {
    addGuard(host, type, restoreModalFocus, true);
  }

  for (const type of MODAL_EVENT_GUARD_TYPES) {
    addGuard(shadow, type, stopPagePropagation);
  }

  return () => {
    cleanupCallbacks.forEach((cleanup) => cleanup());
  };
}

function showApprovalWindowAttention(payload: ToolExecutionPayload): void {
  void showUserAttentionNotification({
    title: t("hitl_title"),
    message: `${t("hitl_intercept")}: ${payload.name}`,
    onlyWhenWindowInBackground: true,
  });
}

export function showConfirmationModal(
  payload: ToolExecutionPayload,
  onConfirm: (scope: CommandApprovalScope) => void,
  onReject: (reason: string) => void,
  options: ApprovalModalOptions = {}
): void {
  const host = createModalHost();
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(createStyleElement());

  const details = getCommandApprovalDetails(payload);
  const card = createModalCard(payload, details, options);
  const overlay = createModalOverlay(card);
  const elements = getModalElements(card);
  if (options.mandatory) {
    elements.btnAlways.style.display = "none";
  }
  const removeModalGuards = installReasonFocusGuards(host, shadow, elements.inputReason);
  const closeModal = createCloseModal(host, removeModalGuards);

  bindModalActions(elements, details, { onConfirm, onReject }, closeModal, options.mandatory === true);
  shadow.appendChild(overlay);
  showApprovalWindowAttention(payload);
}

function createModalHost(): HTMLElement {
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    zIndex: APPROVAL_MODAL_Z_INDEX,
    top: 0,
    left: 0,
    width: "0",
    height: "0",
    outline: "none",
  });
  document.body.appendChild(host);
  return host;
}

function createStyleElement(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = APPROVAL_MODAL_STYLE;
  return style;
}

function createModalCard(
  payload: ToolExecutionPayload,
  details: CommandApprovalDetails,
  options: ApprovalModalOptions
): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = renderApprovalModalHtml(createModalContent(payload, details, options));
  return card;
}

function createModalOverlay(card: HTMLElement): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.appendChild(card);
  return overlay;
}

function createModalContent(
  payload: ToolExecutionPayload,
  details: CommandApprovalDetails,
  options: ApprovalModalOptions
): ApprovalModalContent {
  return {
    alwaysDescription: details.isCommandScopedApproval ? t("cmd_always_desc") : t("always_desc_2"),
    alwaysOptionsHtml: details.isCommandScopedApproval ? renderCommandApprovalOptions(details) : "",
    alwaysTitle: details.isCommandScopedApproval ? t("cmd_always_title") : t("always_title"),
    safeAlwaysTarget: escapeHtml(details.isCommandScopedApproval ? details.commandValue : payload.name),
    safeArgs: escapeHtml(JSON.stringify(payload.arguments ?? {}, null, 2)),
    safeName: escapeHtml(payload.name),
    safePurpose: escapeHtml(payload.purpose ?? "No purpose provided."),
    safeRiskReasons: (options.riskReasons ?? []).map(escapeHtml),
  };
}

function getCommandApprovalDetails(payload: ToolExecutionPayload): CommandApprovalDetails {
  const commandValue = normalizeCommandValue(payload.arguments?.command) ?? "";
  const isCommandScopedApproval = isCommandApprovalPayload(payload.name, commandValue);
  if (!isCommandScopedApproval) {
    return {
      commandValue,
      exactKey: "",
      executableKey: "",
      isBroadExecutable: false,
      isCommandScopedApproval: false,
      prefixKey: "",
    };
  }

  const executableValue = getCommandExecutable(commandValue) ?? "";
  const isBroadExecutable = Boolean(
    executableValue
    && (
      isBroadCommandExecutable(executableValue)
      || !isCommandApprovalScopeAllowed(commandValue, "executable")
    )
  );
  const prefixValue = getCommandPrefix(commandValue) ?? "";
  const contextValue = getCommandApprovalContext(payload.name, payload.arguments);

  return {
    commandValue,
    exactKey: escapeHtml(`command-exact:${payload.name}:${contextValue}:${commandValue}`),
    executableKey: executableValue && !isBroadExecutable
      ? escapeHtml(`command-executable:${payload.name}:${contextValue}:${executableValue}`)
      : "",
    isBroadExecutable,
    isCommandScopedApproval: true,
    prefixKey: prefixValue
      ? escapeHtml(`command-prefix:${payload.name}:${contextValue}:${prefixValue}`)
      : "",
  };
}

function isCommandApprovalPayload(toolName: string, commandValue: string): boolean {
  return (toolName === "execute_command" || toolName === "run_in_terminal") && Boolean(commandValue);
}

function getModalElements(card: HTMLElement): ModalElements {
  return {
    viewMain: card.querySelector("#view-main") as HTMLElement,
    viewAlways: card.querySelector("#view-always-confirm") as HTMLElement,
    btnAlways: card.querySelector(".btn-always") as HTMLButtonElement,
    btnBack: card.querySelector(".btn-back") as HTMLButtonElement,
    btnReject: card.querySelector(".btn-reject") as HTMLButtonElement,
    btnConfirm: card.querySelector(".btn-confirm") as HTMLButtonElement,
    btnConfirmAlways: card.querySelector(".btn-confirm-always") as HTMLButtonElement,
    inputReason: card.querySelector(".reason") as HTMLInputElement,
    btnAllowExact: card.querySelector<HTMLButtonElement>(".btn-allow-exact"),
    btnAllowExecutable: card.querySelector<HTMLButtonElement>(".btn-allow-executable"),
    btnAllowPrefix: card.querySelector<HTMLButtonElement>(".btn-allow-prefix"),
  };
}

function installReasonFocusGuards(
  host: HTMLElement,
  shadow: ShadowRoot,
  inputReason: HTMLInputElement
): () => void {
  return installModalEventGuards(host, shadow, (event) => getReasonFocusTarget(event, shadow, inputReason));
}

function getReasonFocusTarget(
  event: Event,
  shadow: ShadowRoot,
  inputReason: HTMLInputElement
): HTMLElement | null {
  if (inputReason.style.display === "none") {return null;}

  const path = event.composedPath();
  return path.includes(inputReason) || shadow.activeElement === inputReason ? inputReason : null;
}

function createCloseModal(host: HTMLElement, removeModalGuards: () => void): () => void {
  let isClosed = false;
  return () => {
    if (isClosed) {return;}
    isClosed = true;
    clearUserAttention();
    removeModalGuards();
    host.remove();
  };
}

function bindModalActions(
  elements: ModalElements,
  details: CommandApprovalDetails,
  callbacks: ModalCallbacks,
  closeModal: () => void,
  mandatory: boolean
): void {
  const state: ModalState = { rejectStep: 0 };
  elements.btnConfirm.onclick = (event) => confirmTrustedScope(event, false, callbacks, closeModal);
  elements.btnAlways.onclick = (event) => {
    if (event.isTrusted) {showAlwaysApprovalView(elements, details.isCommandScopedApproval);}
  };
  elements.btnConfirmAlways.onclick = (event) => confirmTrustedScope(event, "exact", callbacks, closeModal);
  bindScopeButton(elements.btnAllowExact, "exact", callbacks, closeModal);
  bindScopeButton(elements.btnAllowExecutable, "executable", callbacks, closeModal, details.executableKey);
  bindScopeButton(elements.btnAllowPrefix, "prefix", callbacks, closeModal, details.prefixKey);
  bindRejectFlow(elements, state, callbacks, closeModal);
  bindBackButton(elements, state, mandatory);
}

function confirmTrustedScope(
  event: MouseEvent,
  scope: CommandApprovalScope,
  callbacks: ModalCallbacks,
  closeModal: () => void
): void {
  if (event.isTrusted) {confirmScope(scope, callbacks, closeModal);}
}

function confirmScope(
  scope: CommandApprovalScope,
  callbacks: ModalCallbacks,
  closeModal: () => void
): void {
  closeModal();
  callbacks.onConfirm(scope);
}

function bindScopeButton(
  button: HTMLButtonElement | null,
  scope: CommandApprovalScope,
  callbacks: ModalCallbacks,
  closeModal: () => void,
  ruleKey = "enabled"
): void {
  if (!button || !ruleKey) {
    return;
  }

  button.onclick = (event) => confirmTrustedScope(event, scope, callbacks, closeModal);
}

function showAlwaysApprovalView(elements: ModalElements, isCommandScopedApproval: boolean): void {
  elements.viewMain.style.display = "none";
  elements.viewAlways.style.display = "block";
  elements.btnAlways.style.display = "none";
  elements.btnReject.style.display = "none";
  elements.btnConfirm.style.display = "none";
  elements.btnBack.style.display = "inline-block";
  elements.btnConfirmAlways.style.display = isCommandScopedApproval ? "none" : "inline-block";
}

function bindRejectFlow(
  elements: ModalElements,
  state: ModalState,
  callbacks: ModalCallbacks,
  closeModal: () => void
): void {
  const reject = () => {
    if (state.rejectStep === 0) {
      showRejectReasonView(elements, state);
      return;
    }

    const reason = elements.inputReason.value.trim();
    closeModal();
    callbacks.onReject(reason);
  };
  elements.btnReject.onclick = (event) => {
    if (event.isTrusted) {reject();}
  };
  bindReasonInput(elements, reject);
}

function showRejectReasonView(elements: ModalElements, state: ModalState): void {
  state.rejectStep = 1;
  elements.inputReason.style.display = "block";
  elements.inputReason.focus();
  elements.btnReject.textContent = t("btn_reject_confirm");
  elements.btnConfirm.style.display = "none";
  elements.btnAlways.style.display = "none";
  elements.btnConfirmAlways.style.display = "none";
  elements.btnBack.style.display = "inline-block";
}

function bindBackButton(elements: ModalElements, state: ModalState, mandatory: boolean): void {
  elements.btnBack.onclick = (event) => {
    if (event.isTrusted) {resetModalView(elements, state, mandatory);}
  };
}

function resetModalView(elements: ModalElements, state: ModalState, mandatory: boolean): void {
  state.rejectStep = 0;
  elements.inputReason.style.display = "none";
  elements.inputReason.value = "";
  elements.btnReject.textContent = t("btn_reject");
  elements.viewMain.style.display = "block";
  elements.viewAlways.style.display = "none";
  elements.btnConfirm.style.display = "inline-block";
  elements.btnReject.style.display = "inline-block";
  elements.btnAlways.style.display = mandatory ? "none" : "inline-block";
  elements.btnBack.style.display = "none";
  elements.btnConfirmAlways.style.display = "none";
}

function bindReasonInput(elements: ModalElements, reject: () => void): void {
  elements.inputReason.onkeydown = (event) => {
    if (event.isTrusted && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      reject();
    }
  };
}
