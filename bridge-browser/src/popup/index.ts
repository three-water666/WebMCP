import { isMessageRequest, isStatusResponse, isSuccessResponse } from '../types';
import { createPopupTranslator, renderInstalledDescription, type PopupTranslator } from './i18n';

type PopupElements = {
  loadingView: HTMLElement;
  connectedView: HTMLElement;
  disconnectedView: HTMLElement;
  disconnectedStatusCard: HTMLElement;
  installCard: HTMLElement;
  suspendedHint: HTMLElement;
  expiredCard: HTMLElement;
  statusDot: HTMLElement;
  portDisplay: HTMLElement;
  manualInitBtn: HTMLButtonElement;
  autoSendInput: HTMLInputElement;
  autoApproveToolsInput: HTMLInputElement;
  showLogInput: HTMLInputElement;
  soundInput: HTMLInputElement;
  availableView: HTMLElement;
  gatewayList: HTMLElement;
  sessionPresetToggle: HTMLButtonElement;
  sessionPresetPanel: HTMLElement;
  defaultAutoApproveToolsInput: HTMLInputElement;
  title: HTMLElement;
  connectedText: HTMLElement;
  portLabel: HTMLElement;
  autoSendLabel: HTMLElement;
  autoApproveToolsLabel: HTMLElement;
  showLogLabel: HTMLElement;
  soundLabel: HTMLElement;
  availableGateways: HTMLElement;
  sessionPresetToggleLabel: HTMLElement;
  defaultAutoApproveToolsLabel: HTMLElement;
  sessionPresetHint: HTMLElement;
  checkingTitle: HTMLElement;
  disconnectedTitle: HTMLElement;
  expiredActionTitle: HTMLElement;
  expiredActionDesc: HTMLElement;
  installedTitle: HTMLElement;
  installedDesc: HTMLElement;
  notInstalledTitle: HTMLElement;
  marketplaceHint: HTMLElement;
};

type PopupContext = {
  elements: PopupElements;
  t: PopupTranslator;
};

type ManualInitStatusState = {
  resetTimer: ReturnType<typeof setTimeout> | null;
  token: number;
};

type GatewaySession = {
  port: number;
  token: string;
};

const UI: Record<string, Record<string, string>> = {
  en: {
    title: BRANDING.bridgeName,
    connected_text: "✅ Connected to VS Code",
    port_label: "Port",
    manual_init: "Manual Initialization",
    manual_init_title: "Add initialization context to the current input",
    manual_init_running: "Initializing...",
    manual_init_done: "Initialization added",
    manual_init_attached: "Initialization attached",
    manual_init_failed: "Initialization failed",
    manual_init_unavailable: "Cannot initialize here",
    auto_send: "Auto Send Message",
    show_log: "Show Floating Log",
    notification_sound: "Notification Sound",
    available_gateways: "⚡ Available Gateways",
    disconnected: "🔴 Disconnected",
    installed_title: "👉 Already Installed?",
    installed_desc: `Click ${BRANDING.productName} in the VS Code status bar (bottom right) and follow the steps to launch.`,
    not_installed_title: "👉 Not Installed?",
    marketplace_hint: "Search in VS Code Marketplace:",
    connect_to: "Connect to",
  },
  zh: {
    title: BRANDING.bridgeName,
    connected_text: "✅ 已连接到 VS Code",
    port_label: "端口",
    manual_init: "手动初始化",
    manual_init_title: "将初始化上下文追加到当前输入框",
    manual_init_running: "初始化中...",
    manual_init_done: "初始化上下文已添加",
    manual_init_attached: "初始化上下文已作为 txt 附件添加",
    manual_init_failed: "初始化失败",
    manual_init_unavailable: "当前页面无法初始化",
    auto_send: "自动发送消息",
    show_log: "显示悬浮日志",
    notification_sound: "提示音",
    available_gateways: "⚡ 可用网关",
    disconnected: "🔴 未连接",
    installed_title: "👉 已安装？",
    installed_desc: `点击 VS Code 右下角状态栏中的 ${BRANDING.productName}，并按提示启动服务。`,
    not_installed_title: "👉 未安装？",
    marketplace_hint: "在 VS Code 扩展市场中搜索：",
    connect_to: "连接到",
  },
};

document.addEventListener("DOMContentLoaded", () => {
  void initializePopup();
});

async function initializePopup(): Promise<void> {
  const context = createPopupContext();
  initializeLabels(context);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const currentTabId = currentTab?.id;
  if (!currentTabId) {
    showDisconnectedStatus(context);
    return;
  }

  listenForSessionSettingChanges(currentTabId, context.elements);
  requestCurrentStatus(currentTabId, context);
  bindPopupControls(currentTabId, context);
}

function createPopupContext(): PopupContext {
  return {
    elements: getPopupElements(),
    t: createPopupTranslator(),
  };
}

function getPopupElements(): PopupElements {
  return {
    loadingView: document.getElementById("loadingView") as HTMLElement,
    connectedView: document.getElementById("connectedView") as HTMLElement,
    disconnectedView: document.getElementById("disconnectedView") as HTMLElement,
    disconnectedStatusCard: document.getElementById("disconnectedStatusCard") as HTMLElement,
    installCard: document.getElementById("installCard") as HTMLElement,
    suspendedHint: document.getElementById("suspendedHint") as HTMLElement,
    expiredCard: document.getElementById("expiredCard") as HTMLElement,
    statusDot: document.getElementById("statusDot") as HTMLElement,
    portDisplay: document.getElementById("portDisplay") as HTMLElement,
    manualInitBtn: document.getElementById("manualInitBtn") as HTMLButtonElement,
    autoSendInput: document.getElementById("autoSend") as HTMLInputElement,
    autoApproveToolsInput: document.getElementById("autoApproveTools") as HTMLInputElement,
    showLogInput: document.getElementById("showLog") as HTMLInputElement,
    soundInput: document.getElementById("logSound") as HTMLInputElement,
    availableView: document.getElementById("availableView") as HTMLElement,
    gatewayList: document.getElementById("gatewayList") as HTMLElement,
    sessionPresetToggle: document.getElementById("sessionPresetToggle") as HTMLButtonElement,
    sessionPresetPanel: document.getElementById("sessionPresetPanel") as HTMLElement,
    defaultAutoApproveToolsInput: document.getElementById("defaultAutoApproveTools") as HTMLInputElement,
    title: document.getElementById("title") as HTMLElement,
    connectedText: document.getElementById("connectedText") as HTMLElement,
    portLabel: document.getElementById("portLabel") as HTMLElement,
    autoSendLabel: document.getElementById("autoSendLabel") as HTMLElement,
    autoApproveToolsLabel: document.getElementById("autoApproveToolsLabel") as HTMLElement,
    showLogLabel: document.getElementById("showLogLabel") as HTMLElement,
    soundLabel: document.getElementById("soundLabel") as HTMLElement,
    availableGateways: document.getElementById("availableGateways") as HTMLElement,
    sessionPresetToggleLabel: document.getElementById("sessionPresetToggleLabel") as HTMLElement,
    defaultAutoApproveToolsLabel: document.getElementById("defaultAutoApproveToolsLabel") as HTMLElement,
    sessionPresetHint: document.getElementById("sessionPresetHint") as HTMLElement,
    checkingTitle: document.getElementById("checkingTitle") as HTMLElement,
    disconnectedTitle: document.getElementById("disconnectedTitle") as HTMLElement,
    expiredActionTitle: document.getElementById("expiredActionTitle") as HTMLElement,
    expiredActionDesc: document.getElementById("expiredActionDesc") as HTMLElement,
    installedTitle: document.getElementById("installedTitle") as HTMLElement,
    installedDesc: document.getElementById("installedDesc") as HTMLElement,
    notInstalledTitle: document.getElementById("notInstalledTitle") as HTMLElement,
    marketplaceHint: document.getElementById("marketplaceHint") as HTMLElement,
  };
}

function initializeLabels(context: PopupContext): void {
  const { elements, t } = context;
  elements.title.textContent = t("title");
  elements.connectedText.textContent = t("connected_text");
  elements.portLabel.textContent = t("port_label");
  elements.manualInitBtn.textContent = t("manual_init");
  elements.manualInitBtn.title = t("manual_init_title");
  elements.autoSendLabel.textContent = t("auto_send");
  elements.autoApproveToolsLabel.textContent = t("auto_approve_tools");
  elements.showLogLabel.textContent = t("show_log");
  elements.soundLabel.textContent = t("notification_sound");
  elements.availableGateways.innerHTML = `<span>⚡</span> ${t("available_gateways").replace(/^⚡\s*/, "")}`;
  elements.sessionPresetToggleLabel.textContent = t("session_preset");
  elements.sessionPresetToggle.title = t("session_preset_title");
  elements.sessionPresetHint.textContent = t("session_preset_hint");
  elements.defaultAutoApproveToolsLabel.textContent = t("default_auto_approve_tools");
  elements.checkingTitle.textContent = t("checking_connection");
  elements.disconnectedTitle.textContent = t("disconnected");
  elements.suspendedHint.textContent = t("suspended_hint");
  elements.expiredActionTitle.textContent = t("expired_action_title");
  elements.expiredActionDesc.textContent = t("expired_action_desc");
  elements.installedTitle.textContent = t("installed_title");
  elements.installedDesc.innerHTML = renderInstalledDescription(t);
  elements.notInstalledTitle.textContent = t("not_installed_title");
  elements.marketplaceHint.textContent = t("marketplace_hint");
}

function listenForSessionSettingChanges(currentTabId: number, elements: PopupElements): void {
  chrome.runtime.onMessage.addListener((request: unknown) => {
    if (isMessageRequest(request) && request.type === "LOG_VISIBLE_CHANGED" && request.tabId === currentTabId) {
      elements.showLogInput.checked = request.show === true;
    }
    if (isMessageRequest(request) && request.type === "AUTO_SEND_CHANGED" && request.tabId === currentTabId) {
      elements.autoSendInput.checked = request.autoSend !== false;
    }
    if (
      isMessageRequest(request) &&
      request.type === "AUTO_APPROVE_TOOLS_CHANGED" &&
      request.tabId === currentTabId
    ) {
      elements.autoApproveToolsInput.checked = request.autoApproveTools === true;
    }
    if (isMessageRequest(request) && request.type === "DEFAULT_AUTO_APPROVE_TOOLS_CHANGED") {
      elements.defaultAutoApproveToolsInput.checked = request.defaultAutoApproveTools === true;
    }
  });
}

function requestCurrentStatus(currentTabId: number, context: PopupContext): void {
  chrome.runtime.sendMessage(
    { type: "GET_STATUS", tabId: currentTabId },
    (response: unknown) => {
      if (isStatusResponse(response) && response.connected) {
        showConnectedStatus(response, context.elements);
      } else if (isStatusResponse(response) && isExpiredDisconnectReason(response.disconnectReason)) {
        showExpiredStatus(context);
      } else if (isStatusResponse(response) && response.suspended === true) {
        showSuspendedStatus(context);
      } else {
        showDisconnectedStatus(context);
      }
    }
  );
}

function showConnectedStatus(
  response: { port?: number; showLog?: boolean; soundEnabled?: boolean },
  elements: PopupElements
): void {
  response: {
    port?: number;
    showLog?: boolean;
    autoSend?: boolean;
    autoApproveTools?: boolean;
    defaultAutoApproveTools?: boolean;
  },
  elements: PopupElements
): void {
  elements.loadingView.classList.add("hidden");
  elements.connectedView.classList.remove("hidden");
  elements.disconnectedView.classList.add("hidden");
  elements.statusDot.classList.add("online");
  elements.statusDot.classList.remove("suspended", "expired");
  elements.portDisplay.innerText = String(response.port ?? "");
  elements.autoSendInput.checked = response.autoSend !== false;
  elements.autoApproveToolsInput.checked = response.autoApproveTools === true;
  elements.defaultAutoApproveToolsInput.checked = response.defaultAutoApproveTools === true;
  elements.showLogInput.checked = response.showLog === true;
  elements.soundInput.checked = response.soundEnabled === true;
}

function showSuspendedStatus(context: PopupContext): void {
  const { elements, t } = context;
  elements.loadingView.classList.add("hidden");
  elements.connectedView.classList.add("hidden");
  elements.disconnectedView.classList.remove("hidden");
  elements.statusDot.classList.remove("online", "expired");
  elements.statusDot.classList.add("suspended");
  elements.disconnectedStatusCard.classList.remove("disconnected", "expired");
  elements.disconnectedStatusCard.classList.add("suspended");
  elements.disconnectedTitle.classList.remove("disconnected", "expired");
  elements.disconnectedTitle.classList.add("suspended");
  elements.disconnectedTitle.textContent = t("suspended");
  elements.suspendedHint.classList.remove("hidden");
  elements.expiredCard.classList.add("hidden");
  elements.installCard.classList.add("hidden");
}

function showExpiredStatus(context: PopupContext): void {
  const { elements, t } = context;
  elements.loadingView.classList.add("hidden");
  elements.connectedView.classList.add("hidden");
  elements.disconnectedView.classList.remove("hidden");
  elements.statusDot.classList.remove("online", "suspended");
  elements.statusDot.classList.add("expired");
  elements.disconnectedStatusCard.classList.remove("disconnected", "suspended");
  elements.disconnectedStatusCard.classList.add("expired");
  elements.disconnectedTitle.classList.remove("disconnected", "suspended");
  elements.disconnectedTitle.classList.add("expired");
  elements.disconnectedTitle.textContent = t("connection_expired");
  elements.suspendedHint.classList.add("hidden");
  elements.expiredCard.classList.remove("hidden");
  elements.installCard.classList.add("hidden");
}

function showDisconnectedStatus(context: PopupContext): void {
  const { elements, t } = context;
  elements.loadingView.classList.add("hidden");
  elements.connectedView.classList.add("hidden");
  elements.statusDot.classList.remove("online", "suspended", "expired");
  elements.disconnectedStatusCard.classList.remove("suspended", "expired");
  elements.disconnectedStatusCard.classList.add("disconnected");
  elements.disconnectedTitle.classList.remove("suspended", "expired");
  elements.disconnectedTitle.classList.add("disconnected");
  elements.disconnectedTitle.textContent = t("disconnected");
  elements.suspendedHint.classList.add("hidden");
  elements.expiredCard.classList.add("hidden");
  elements.installCard.classList.remove("hidden");
  elements.disconnectedView.classList.remove("hidden");
}

function isExpiredDisconnectReason(reason: unknown): boolean {
  return reason === "gateway_unavailable" ||
    reason === "invalid_token" ||
    reason === "invalid_session";
}

function bindPopupControls(currentTabId: number, context: PopupContext): void {
  bindManualInitButton(currentTabId, context);
  bindSessionPresetToggle(context.elements);
  bindAutoSendToggle(currentTabId, context.elements.autoSendInput);
  bindAutoApproveToolsToggle(currentTabId, context.elements.autoApproveToolsInput);
  bindDefaultAutoApproveToolsToggle(context.elements.defaultAutoApproveToolsInput);
  bindLogToggle(currentTabId, context.elements.showLogInput);
}

function bindSessionPresetToggle(elements: PopupElements): void {
  elements.sessionPresetToggle.addEventListener("click", () => {
    const nextExpanded = elements.sessionPresetToggle.getAttribute("aria-expanded") !== "true";
    setSessionPresetPanelExpanded(elements, nextExpanded);
  });
}

function bindPopupControls(currentTabId: number, context: PopupContext): void {
  bindManualInitButton(currentTabId, context);
  bindAutoSendToggle(context.elements.autoSendInput);
  bindLogToggle(currentTabId, context.elements.showLogInput);
  bindSoundToggle(currentTabId, context.elements.soundInput);
function setSessionPresetPanelExpanded(elements: PopupElements, expanded: boolean): void {
  elements.sessionPresetToggle.setAttribute("aria-expanded", String(expanded));
  elements.sessionPresetPanel.classList.toggle("hidden", !expanded);
}

function bindManualInitButton(currentTabId: number, context: PopupContext): void {
  const statusState: ManualInitStatusState = {
    resetTimer: null,
    token: 0,
  };

  context.elements.manualInitBtn.addEventListener("click", () => {
    const token = startManualInitStatus(context, statusState);

    chrome.tabs.sendMessage(currentTabId, { type: "MANUAL_INIT" }, (response: unknown) => {
      if (chrome.runtime.lastError) {
        showManualInitStatus(context, statusState, token, "manual_init_unavailable", false);
        return;
      }

      if (isSuccessResponse(response) && response.success) {
        const labelKey = isAttachedResponse(response) ? "manual_init_attached" : "manual_init_done";
        showManualInitStatus(context, statusState, token, labelKey, true);
        return;
      }

      showManualInitStatus(context, statusState, token, "manual_init_failed", false);
    });
  });
}

function startManualInitStatus(context: PopupContext, state: ManualInitStatusState): number {
  state.token += 1;
  clearManualInitStatusTimer(state);

  const button = context.elements.manualInitBtn;
  button.disabled = true;
  button.innerText = context.t("manual_init_running");
  button.style.backgroundColor = "";

  return state.token;
}

function isAttachedResponse(response: unknown): boolean {
  return typeof response === "object" &&
    response !== null &&
    "attached" in response &&
    (response as { attached?: unknown }).attached === true;
}

function showManualInitStatus(
  context: PopupContext,
  state: ManualInitStatusState,
  token: number,
  labelKey: string,
  success: boolean
): void {
  if (token !== state.token) {return;}
  clearManualInitStatusTimer(state);

  const button = context.elements.manualInitBtn;
  button.disabled = false;
  button.innerText = context.t(labelKey);
  button.style.backgroundColor = success ? "#0d8a6a" : "#8a3d3d";

  state.resetTimer = setTimeout(() => {
    if (token !== state.token) {return;}
    button.innerText = context.t("manual_init");
    button.style.backgroundColor = "";
    state.resetTimer = null;
  }, 3000);
}

function clearManualInitStatusTimer(state: ManualInitStatusState): void {
  if (!state.resetTimer) {return;}
  clearTimeout(state.resetTimer);
  state.resetTimer = null;
}

function bindAutoSendToggle(currentTabId: number, autoSendInput: HTMLInputElement): void {
  autoSendInput.addEventListener("change", () => {
    void chrome.runtime.sendMessage({
      type: "SET_AUTO_SEND",
      tabId: currentTabId,
      autoSend: autoSendInput.checked,
    });
  });
}

function bindAutoApproveToolsToggle(
  currentTabId: number,
  autoApproveToolsInput: HTMLInputElement
): void {
  autoApproveToolsInput.addEventListener("change", () => {
    void chrome.runtime.sendMessage({
      type: "SET_AUTO_APPROVE_TOOLS",
      tabId: currentTabId,
      autoApproveTools: autoApproveToolsInput.checked,
    });
  });
}

function bindDefaultAutoApproveToolsToggle(defaultAutoApproveToolsInput: HTMLInputElement): void {
  defaultAutoApproveToolsInput.addEventListener("change", () => {
    void chrome.runtime.sendMessage({
      type: "SET_DEFAULT_AUTO_APPROVE_TOOLS",
      defaultAutoApproveTools: defaultAutoApproveToolsInput.checked,
    });
  });
}

function bindLogToggle(currentTabId: number, showLogInput: HTMLInputElement): void {
  showLogInput.addEventListener("change", () => {
    void chrome.runtime.sendMessage({
      type: "SET_LOG_VISIBLE",
      tabId: currentTabId,
      show: showLogInput.checked,
    });
  });
}

function bindSoundToggle(currentTabId: number, soundInput: HTMLInputElement): void {
  chrome.storage.sync.get(["logSoundEnabled"], (items: Record<string, unknown>) => {
    if (typeof items.logSoundEnabled === "boolean") {
      soundInput.checked = items.logSoundEnabled;
    }
  });

  soundInput.addEventListener("change", () => {
    const soundEnabled = soundInput.checked;
    void chrome.storage.sync.set({ logSoundEnabled: soundEnabled });
    void chrome.tabs.sendMessage(currentTabId, {
      type: "SET_LOG_SOUND_ENABLED",
      soundEnabled,
    }).catch(() => {
      void chrome.runtime.lastError;
    });
  });
}
