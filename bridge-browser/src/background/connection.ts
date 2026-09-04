import { BRANDING } from '@webcode/shared';

import { type HandshakeResponse, isStoredSession, type MessageRequest } from '../types';
import { updateBadge } from './badge';
import {
  getBridgeRedemptionError,
  normalizeRedeemedBridgeSession,
  type RedeemedBridgeSession,
} from './bridge_redemption';
import { fetchInitDataFromGateway } from './init_sync';
import { getSessionPresetSettings } from './presets';
import { clearSessionExpiryCheck, scheduleSessionExpiryCheck } from './session_health';
import { removeSession, saveSession } from './sessions';

interface HandshakeParams {
  port: number;
  bridgeCode: string;
  force?: boolean;
  vscodeExtensionVersion: string;
  browserExtensionVersion: string;
}

type BridgeRedemptionResult =
  | { success: true; session: RedeemedBridgeSession }
  | { success: false; error: string };

const BRIDGE_REDEMPTION_TIMEOUT_MS = 5000;

export async function handleHandshake(request: MessageRequest, tabId: number | null | undefined): Promise<HandshakeResponse> {
  const params = getHandshakeParams(request);

  if (!tabId) {return { success: false, error: "No Tab ID" };}
  if (!params) {
    return { success: false, error: "Invalid handshake parameters" };
  }

  const conflictTabId = await findConflictTabId(params.port, tabId);
  let replacedTabId: number | null = null;
  if (conflictTabId) {
    if (!params.force) {
      try {
        const tab = await chrome.tabs.get(parseInt(conflictTabId, 10));
        if (tab) {
          return { success: false, error: "BUSY", conflictTabId };
        }
      } catch {
        const staleTabId = parseInt(conflictTabId, 10);
        await removeSession(staleTabId);
        await clearSessionExpiryCheck(staleTabId);
      }
    } else {
      replacedTabId = parseInt(conflictTabId, 10);
    }
  }

  const redemption = await redeemBridgeCode(
    params.port,
    params.bridgeCode,
    params.browserExtensionVersion
  );
  if (!redemption.success) {
    return redemption;
  }
  const session = redemption.session;
  if (replacedTabId) {
    await removeSession(replacedTabId, "invalid_token");
    await clearSessionExpiryCheck(replacedTabId);
  }
  if (session.vscodeExtensionVersion !== params.browserExtensionVersion) {
    return { success: false, error: "VS Code and browser extension versions do not match." };
  }

  await bindSession(tabId, {
    port: params.port,
    token: session.token,
    workspaceId: session.workspaceId,
    siteId: session.siteId,
    targetOrigin: session.targetOrigin,
    targetUrl: session.targetUrl,
    idleTimeoutMs: session.idleTimeoutMs,
  });
  return { success: true, targetUrl: session.targetUrl };
}

interface BindSessionOptions {
  port: number;
  token: string;
  workspaceId: string;
  siteId: string;
  targetOrigin: string;
  targetUrl: string;
  idleTimeoutMs: number;
}

export async function bindSession(tabId: number, options: BindSessionOptions) {
  const presetSettings = await getSessionPresetSettings();
  const lastGatewayActivityAt = Date.now();
  const session = {
    port: options.port,
    token: options.token,
    showLog: false,
    autoSend: true,
    autoApproveTools: presetSettings.defaultAutoApproveTools,
    workspaceId: options.workspaceId,
    lastGatewayActivityAt,
    gatewayIdleTimeoutMs: options.idleTimeoutMs,
    siteId: options.siteId,
    targetOrigin: options.targetOrigin,
    targetUrl: options.targetUrl,
  };
  await saveSession(tabId, session);
  scheduleSessionExpiryCheck(tabId, lastGatewayActivityAt, options.idleTimeoutMs);
  console.log(`${BRANDING.logPrefix} Tab ${tabId} bound to Port ${options.port} [Workspace: ${options.workspaceId}]`);
  updateBadge(tabId, true);
  // [Sync] Notify Content Script
  void chrome.tabs.sendMessage(tabId, {
    type: "STATUS_UPDATE",
    connected: true,
    workspaceId: options.workspaceId,
    siteId: options.siteId,
    autoSend: session.autoSend,
    autoApproveTools: session.autoApproveTools,
  }).catch(ignoreRuntimeError);
  // 不再 await，避免网关初始化请求阻塞握手响应
  void fetchInitDataFromGateway(options.port, options.token);
}

function ignoreRuntimeError(_error: unknown): void {
  void chrome.runtime.lastError;
}

function getHandshakeParams(request: MessageRequest): HandshakeParams | null {
  if (
    !isValidPort(request.port) ||
    !isNonEmptyString(request.bridgeCode) ||
    !isCompatibleExtensionVersions(request)
  ) {
    return null;
  }

  return {
    port: request.port,
    bridgeCode: request.bridgeCode,
    force: request.force,
    vscodeExtensionVersion: request.vscodeExtensionVersion,
    browserExtensionVersion: request.browserExtensionVersion,
  };
}

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCompatibleExtensionVersions(request: MessageRequest): request is MessageRequest & {
  vscodeExtensionVersion: string;
  browserExtensionVersion: string;
} {
  const currentBrowserVersion = chrome.runtime.getManifest().version;

  return isNonEmptyString(request.vscodeExtensionVersion) &&
    isNonEmptyString(request.browserExtensionVersion) &&
    request.vscodeExtensionVersion === currentBrowserVersion &&
    request.browserExtensionVersion === currentBrowserVersion;
}

async function redeemBridgeCode(
  port: number,
  bridgeCode: string,
  browserExtensionVersion: string
): Promise<BridgeRedemptionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRIDGE_REDEMPTION_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/bridge/redeem`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridgeCode, browserExtensionVersion }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        success: false,
        error: getBridgeRedemptionError(body),
      };
    }

    const session = normalizeRedeemedBridgeSession(body);
    return session
      ? { success: true, session }
      : { success: false, error: "Gateway returned an invalid bridge session." };
  } catch {
    return { success: false, error: "Gateway bridge redemption failed." };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findConflictTabId(port: number, tabId: number): Promise<string | null> {
  const all = await chrome.storage.local.get(null) as Record<string, unknown>;
  for (const [key, val] of Object.entries(all)) {
    if (isConflictingSession(key, val, port, tabId)) {
      return key.replace("session_", "");
    }
  }

  return null;
}

function isConflictingSession(key: string, value: unknown, port: number, tabId: number): boolean {
  return key.startsWith("session_") &&
    isStoredSession(value) &&
    value.port === port &&
    key !== `session_${tabId}`;
}
