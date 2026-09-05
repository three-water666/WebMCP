import { isMessageRequest, type MessageRequest, type SessionDisconnectReason } from '../types';
import { playAttentionSound } from './attention_sound';
import { handleHandshake } from './connection';
import { getErrorMessage } from './errors';
import { approveTool, executeTool, preflightTool } from './gateway';
import { showNotification, updateWindowAttention } from './notifications';
import { getSessionPresetSettings, updateDefaultAutoApproveTools, type SessionPresetSettings } from './presets';
import { checkGatewayHealth, expireGatewaySession, type GatewayHealthStatus } from './session_health';
import {
  getActiveProtocolSessionResult,
  getSessionDisconnectReason,
  updateSessionAutoApproveTools,
  updateSessionAutoSend,
  updateSessionLog,
} from './sessions';

type SendResponse = (response?: unknown) => void;

export function handleRuntimeMessage(
  request: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse
): boolean {
  if (!isMessageRequest(request)) {
    return false;
  }

  return dispatchRuntimeMessage(request, sender, sendResponse);
}

function dispatchRuntimeMessage(
  request: MessageRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse
): boolean {
  const currentTabId = sender.tab ? sender.tab.id : null;

  if (dispatchSettingsRuntimeMessage(request, currentTabId, sendResponse)) {
    return true;
  }

  switch (request.type) {
    case "HANDSHAKE":
      return handleHandshakeRuntimeMessage(request, sender, currentTabId, sendResponse);
    case "GET_STATUS":
      handleGetStatus(request, sender, sendResponse);
      return true;
    case "REQUEST_USER_ATTENTION":
      respondAsync(requestUserAttention(request, sender), sendResponse);
      return true;
    case "CLEAR_WINDOW_ATTENTION":
      respondAsync(updateWindowAttention(sender, false), sendResponse);
      return true;
    case "EXECUTE_TOOL":
      respondAsync(executeTool(request, currentTabId, sender.url), sendResponse);
      return true;
    case "PREFLIGHT_TOOL":
      respondAsync(preflightTool(request, currentTabId, sender.url), sendResponse);
      return true;
    case "APPROVE_TOOL":
      respondAsync(approveTool(request, currentTabId, sender.url), sendResponse);
      return true;
    case "SHOW_NOTIFICATION":
      respondAsync(showNotification(request, sender), sendResponse);
      return true;
    case "SYNC_CONFIG":
      sendResponse({ success: true });
      return true;
    default:
      return false;
  }
}

function handleHandshakeRuntimeMessage(
  request: Extract<MessageRequest, { type: "HANDSHAKE" }>,
  sender: chrome.runtime.MessageSender,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): boolean {
  if (!isValidHandshakeSender(request, sender)) {
    sendResponse({ success: false, error: "Invalid handshake source" });
    return true;
  }

  respondAsync(handleHandshake(request, currentTabId), sendResponse);
  return true;
}

function isValidHandshakeSender(
  request: Extract<MessageRequest, { type: "HANDSHAKE" }>,
  sender: chrome.runtime.MessageSender
): boolean {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url || typeof request.port !== "number") {
    return false;
  }

  try {
    const url = new URL(sender.url);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.pathname === "/bridge" &&
      Number(url.port) === request.port;
  } catch {
    return false;
  }
}

function dispatchSettingsRuntimeMessage(
  request: MessageRequest,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): boolean {
  switch (request.type) {
    case "SET_LOG_VISIBLE":
      handleSetLogVisible(request, currentTabId, sendResponse);
      return true;
    case "SET_AUTO_SEND":
      handleSetAutoSend(request, currentTabId, sendResponse);
      return true;
    case "SET_AUTO_APPROVE_TOOLS":
      handleSetAutoApproveTools(request, currentTabId, sendResponse);
      return true;
    case "SET_DEFAULT_AUTO_APPROVE_TOOLS":
      handleSetDefaultAutoApproveTools(request, sendResponse);
      return true;
    default:
      return false;
  }
}

function handleGetStatus(
  request: MessageRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse
): void {
  const targetTabId = request.tabId ?? (sender.tab ? sender.tab.id : null);
  if (!targetTabId) {
    sendResponse({ connected: false, error: "Unknown Tab ID" });
    return;
  }

  respondAsync(getStatusResponse(targetTabId), sendResponse);
}

async function getStatusResponse(targetTabId: number) {
  const [sessionResult, presetSettings] = await Promise.all([
    getActiveProtocolSessionResult(targetTabId),
    getSessionPresetSettings(),
  ]);
  if (sessionResult.status === "missing") {
    const disconnectReason = await getSessionDisconnectReason(targetTabId);
    return createDisconnectedStatusResponse(presetSettings, disconnectReason);
  }

  if (sessionResult.status === "invalid") {
    return createDisconnectedStatusResponse(
      presetSettings,
      "invalid_session",
      "Session data is incomplete. Reconnect from VS Code to continue."
    );
  }

  const session = sessionResult.session;
  const healthStatus = await checkGatewayHealth(session);
  if (healthStatus !== "online") {
    const disconnectReason = getDisconnectReasonForHealthStatus(healthStatus);
    await expireGatewaySession(targetTabId, disconnectReason);
    return createDisconnectedStatusResponse(presetSettings, disconnectReason);
  }

  const isActive = sessionResult.status === "active";
  return {
    connected: isActive,
    suspended: !isActive,
    port: isActive ? session.port : undefined,
    showLog: session.showLog ?? false,
    autoSend: session.autoSend ?? true,
    autoApproveTools: session.autoApproveTools ?? false,
    defaultAutoApproveTools: presetSettings.defaultAutoApproveTools,
    workspaceId: session.workspaceId ?? 'global',
    siteId: session.siteId,
  };
}

function createDisconnectedStatusResponse(
  presetSettings: SessionPresetSettings,
  disconnectReason?: SessionDisconnectReason,
  error?: string
) {
  return {
    connected: false,
    suspended: false,
    disconnectReason,
    showLog: false,
    autoSend: true,
    autoApproveTools: false,
    defaultAutoApproveTools: presetSettings.defaultAutoApproveTools,
    workspaceId: 'global',
    error,
  };
}

function getDisconnectReasonForHealthStatus(status: GatewayHealthStatus): SessionDisconnectReason {
  return status === "unauthorized" ? "invalid_token" : "gateway_unavailable";
}

function handleSetLogVisible(
  request: MessageRequest,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): void {
  const targetTabId = request.tabId ?? currentTabId;
  const show = request.show ?? false;
  if (!targetTabId) {
    sendResponse({ success: false, error: "Missing Tab ID" });
    return;
  }

  respondAsync(
    updateSessionLog(targetTabId, show).then(() => {
      void chrome.tabs.sendMessage(targetTabId, { type: "TOGGLE_LOG", show }).catch(ignoreRuntimeError);
      chrome.runtime.sendMessage({ type: "LOG_VISIBLE_CHANGED", tabId: targetTabId, show }, () => {
        void chrome.runtime.lastError;
      });
      return { success: true };
    }),
    sendResponse
  );
}

function handleSetAutoSend(
  request: MessageRequest,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): void {
  const targetTabId = request.tabId ?? currentTabId;
  if (!targetTabId) {
    sendResponse({ success: false, error: "Missing Tab ID" });
    return;
  }

  if (typeof request.autoSend !== "boolean") {
    sendResponse({ success: false, error: "Missing auto-send value" });
    return;
  }

  const autoSend = request.autoSend;
  respondAsync(
    updateSessionAutoSend(targetTabId, autoSend).then(() => {
      void chrome.tabs.sendMessage(targetTabId, { type: "SET_AUTO_SEND", autoSend }).catch(ignoreRuntimeError);
      chrome.runtime.sendMessage({ type: "AUTO_SEND_CHANGED", tabId: targetTabId, autoSend }, () => {
        void chrome.runtime.lastError;
      });
      return { success: true };
    }),
    sendResponse
  );
}

function handleSetAutoApproveTools(
  request: MessageRequest,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): void {
  const targetTabId = request.tabId ?? currentTabId;
  if (!targetTabId) {
    sendResponse({ success: false, error: "Missing Tab ID" });
    return;
  }

  if (typeof request.autoApproveTools !== "boolean") {
    sendResponse({ success: false, error: "Missing auto-approve value" });
    return;
  }

  const autoApproveTools = request.autoApproveTools;
  respondAsync(
    updateSessionAutoApproveTools(targetTabId, autoApproveTools).then(() => {
      void chrome.tabs
        .sendMessage(targetTabId, { type: "SET_AUTO_APPROVE_TOOLS", autoApproveTools })
        .catch(ignoreRuntimeError);
      chrome.runtime.sendMessage(
        { type: "AUTO_APPROVE_TOOLS_CHANGED", tabId: targetTabId, autoApproveTools },
        () => {
          void chrome.runtime.lastError;
        }
      );
      return { success: true };
    }),
    sendResponse
  );
}

function handleSetDefaultAutoApproveTools(
  request: MessageRequest,
  sendResponse: SendResponse
): void {
  if (typeof request.defaultAutoApproveTools !== "boolean") {
    sendResponse({ success: false, error: "Missing default auto-approve value" });
    return;
  }

  const defaultAutoApproveTools = request.defaultAutoApproveTools;
  respondAsync(
    updateDefaultAutoApproveTools(defaultAutoApproveTools).then((presetSettings) => {
      chrome.runtime.sendMessage(
        {
          type: "DEFAULT_AUTO_APPROVE_TOOLS_CHANGED",
          defaultAutoApproveTools: presetSettings.defaultAutoApproveTools,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
      return { success: true };
    }),
    sendResponse
  );
}

async function requestUserAttention(
  request: MessageRequest,
  sender: chrome.runtime.MessageSender
): Promise<{ success: boolean; error?: string; skipped?: boolean; sound?: "played" | "failed"; soundError?: string }> {
  const attentionResult = await updateWindowAttention(sender, true);

  if (!request.playSound) {
    return attentionResult;
  }

  const soundResult = await playAttentionSound();
  if (!soundResult.success) {
    return {
      ...attentionResult,
      sound: "failed",
      soundError: soundResult.error,
    };
  }

  return {
    ...attentionResult,
    sound: "played",
  };
}

function respondAsync<T>(promise: Promise<T>, sendResponse: SendResponse): void {
  void promise.catch((error: unknown) => ({
    success: false,
    error: getErrorMessage(error),
  })).then(sendResponse);
}

function ignoreRuntimeError(_error: unknown): void {
  void chrome.runtime.lastError;
}
