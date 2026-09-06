import {
  isSiteNetworkCaptureConfig,
  type Session,
  type SiteNetworkCaptureConfig,
  type ToolExecutionPayload,
  type ToolExecutionTransportPayload,
} from '@webcode/shared';
import { type SiteSelectors } from './modules/config';

// Re-export shared types for convenience
export type { Session, SiteNetworkCaptureConfig, ToolExecutionPayload, ToolExecutionTransportPayload };

// === Extension-Internal Types ===

export interface HandshakeMessageRequest {
  type: "HANDSHAKE";
  port: number;
  bridgeCode: string;
  bridgeProtocolVersion: number;
  vscodeExtensionVersion: string;
  browserExtensionVersion: string;
  force?: boolean;
}

export interface GetStatusMessageRequest {
  type: "GET_STATUS";
  tabId?: number;
}

export interface RequestUserAttentionMessageRequest {
  type: "REQUEST_USER_ATTENTION";
  playSound?: boolean;
}

export interface ClearWindowAttentionMessageRequest {
  type: "CLEAR_WINDOW_ATTENTION";
}

export interface ExecuteToolMessageRequest {
  type: "EXECUTE_TOOL";
  payload: ToolExecutionTransportPayload;
  approvalToken?: string;
}

export interface PreflightToolMessageRequest {
  type: "PREFLIGHT_TOOL";
  payload: ToolExecutionTransportPayload;
}

export interface ApproveToolMessageRequest {
  type: "APPROVE_TOOL";
  challengeId: string;
}

export interface ShowNotificationMessageRequest {
  type: "SHOW_NOTIFICATION";
  title?: string;
  message?: string;
  onlyWhenWindowInBackground?: boolean;
}

export interface SyncConfigMessageRequest {
  type: "SYNC_CONFIG";
}

export interface SetLogVisibleMessageRequest {
  type: "SET_LOG_VISIBLE";
  tabId?: number;
  show: boolean;
}

export interface SetAutoSendMessageRequest {
  type: "SET_AUTO_SEND";
  tabId?: number;
  autoSend: boolean;
}

export interface SetAutoApproveToolsMessageRequest {
  type: "SET_AUTO_APPROVE_TOOLS";
  tabId?: number;
  autoApproveTools: boolean;
}

export interface SetDefaultAutoApproveToolsMessageRequest {
  type: "SET_DEFAULT_AUTO_APPROVE_TOOLS";
  defaultAutoApproveTools: boolean;
}

export interface ManualInitMessageRequest {
  type: "MANUAL_INIT";
}

export interface ToggleLogMessageRequest {
  type: "TOGGLE_LOG";
  show: boolean;
}

export interface StatusUpdateMessageRequest {
  type: "STATUS_UPDATE";
  connected: boolean;
  siteId?: string;
  workspaceId?: string;
  autoSend?: boolean;
  autoApproveTools?: boolean;
}

export interface LogVisibleChangedMessageRequest {
  type: "LOG_VISIBLE_CHANGED";
  tabId: number;
  show: boolean;
}

export interface AutoSendChangedMessageRequest {
  type: "AUTO_SEND_CHANGED";
  tabId: number;
  autoSend: boolean;
}

export interface AutoApproveToolsChangedMessageRequest {
  type: "AUTO_APPROVE_TOOLS_CHANGED";
  tabId: number;
  autoApproveTools: boolean;
}

export interface DefaultAutoApproveToolsChangedMessageRequest {
  type: "DEFAULT_AUTO_APPROVE_TOOLS_CHANGED";
  defaultAutoApproveTools: boolean;
}

export type MessageRequest =
  | HandshakeMessageRequest
  | GetStatusMessageRequest
  | RequestUserAttentionMessageRequest
  | ClearWindowAttentionMessageRequest
  | ExecuteToolMessageRequest
  | PreflightToolMessageRequest
  | ApproveToolMessageRequest
  | ShowNotificationMessageRequest
  | SyncConfigMessageRequest
  | SetLogVisibleMessageRequest
  | SetAutoSendMessageRequest
  | SetAutoApproveToolsMessageRequest
  | SetDefaultAutoApproveToolsMessageRequest
  | ManualInitMessageRequest
  | ToggleLogMessageRequest
  | StatusUpdateMessageRequest
  | LogVisibleChangedMessageRequest
  | AutoSendChangedMessageRequest
  | AutoApproveToolsChangedMessageRequest
  | DefaultAutoApproveToolsChangedMessageRequest;

export type BackgroundActionRuntimeMessageRequest =
  | HandshakeMessageRequest
  | GetStatusMessageRequest
  | RequestUserAttentionMessageRequest
  | ClearWindowAttentionMessageRequest
  | ExecuteToolMessageRequest
  | PreflightToolMessageRequest
  | ApproveToolMessageRequest
  | ShowNotificationMessageRequest
  | SyncConfigMessageRequest;

export type SettingsRuntimeMessageRequest =
  | SetLogVisibleMessageRequest
  | SetAutoSendMessageRequest
  | SetAutoApproveToolsMessageRequest
  | SetDefaultAutoApproveToolsMessageRequest;

export type BackgroundRuntimeMessageRequest =
  | BackgroundActionRuntimeMessageRequest
  | SettingsRuntimeMessageRequest;

export interface HandshakeResponse {
  success: boolean;
  error?: string;
  conflictTabId?: string;
  targetUrl?: string;
}

export interface StatusResponse {
  connected: boolean;
  suspended?: boolean;
  disconnectReason?: SessionDisconnectReason;
  error?: string;
  port?: number;
  showLog?: boolean;
  autoSend?: boolean;
  autoApproveTools?: boolean;
  defaultAutoApproveTools?: boolean;
  workspaceId?: string;
  siteId?: string;
}

export interface SuccessResponse {
  success: boolean;
  error?: string;
}

export interface SyncedAiSite {
  capture?: unknown;
  id: string;
  name?: string;
  selectors?: unknown;
}

export interface StoredSession {
  port: number;
  token: string;
  showLog?: boolean;
  autoSend?: boolean;
  autoApproveTools?: boolean;
  workspaceId?: string;
  lastGatewayActivityAt?: number;
  gatewayIdleTimeoutMs?: number;
  siteId?: string;
  targetOrigin?: string;
  targetUrl?: string;
  allowedOrigins?: string[];
}

export type SessionDisconnectReason =
  | "gateway_unavailable"
  | "invalid_token"
  | "invalid_session";

export interface InitGatewayData {
  syncedAiSites?: SyncedAiSite[];
  prompts?: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type MessageRequestValidator = (value: Record<string, unknown>) => boolean;

const MESSAGE_REQUEST_VALIDATORS = {
  HANDSHAKE: (value) =>
    typeof value.port === "number" &&
    typeof value.bridgeCode === "string" &&
    typeof value.bridgeProtocolVersion === "number" &&
    typeof value.vscodeExtensionVersion === "string" &&
    typeof value.browserExtensionVersion === "string" &&
    isOptionalBoolean(value.force),
  GET_STATUS: (value) => isOptionalNumber(value.tabId),
  REQUEST_USER_ATTENTION: (value) => isOptionalBoolean(value.playSound),
  CLEAR_WINDOW_ATTENTION: () => true,
  EXECUTE_TOOL: (value) =>
    isToolExecutionTransportPayload(value.payload) &&
    isOptionalString(value.approvalToken),
  PREFLIGHT_TOOL: (value) => isToolExecutionTransportPayload(value.payload),
  APPROVE_TOOL: (value) => typeof value.challengeId === "string",
  SHOW_NOTIFICATION: (value) =>
    isOptionalString(value.title) &&
    isOptionalString(value.message) &&
    isOptionalBoolean(value.onlyWhenWindowInBackground),
  SYNC_CONFIG: () => true,
  SET_LOG_VISIBLE: (value) =>
    isOptionalNumber(value.tabId) && typeof value.show === "boolean",
  SET_AUTO_SEND: (value) =>
    isOptionalNumber(value.tabId) && typeof value.autoSend === "boolean",
  SET_AUTO_APPROVE_TOOLS: (value) =>
    isOptionalNumber(value.tabId) && typeof value.autoApproveTools === "boolean",
  SET_DEFAULT_AUTO_APPROVE_TOOLS: (value) =>
    typeof value.defaultAutoApproveTools === "boolean",
  MANUAL_INIT: () => true,
  TOGGLE_LOG: (value) => typeof value.show === "boolean",
  STATUS_UPDATE: (value) =>
    typeof value.connected === "boolean" &&
    isOptionalString(value.siteId) &&
    isOptionalString(value.workspaceId) &&
    isOptionalBoolean(value.autoSend) &&
    isOptionalBoolean(value.autoApproveTools),
  LOG_VISIBLE_CHANGED: (value) =>
    typeof value.tabId === "number" && typeof value.show === "boolean",
  AUTO_SEND_CHANGED: (value) =>
    typeof value.tabId === "number" && typeof value.autoSend === "boolean",
  AUTO_APPROVE_TOOLS_CHANGED: (value) =>
    typeof value.tabId === "number" && typeof value.autoApproveTools === "boolean",
  DEFAULT_AUTO_APPROVE_TOOLS_CHANGED: (value) =>
    typeof value.defaultAutoApproveTools === "boolean",
} satisfies Record<MessageRequest["type"], MessageRequestValidator>;

const BACKGROUND_RUNTIME_MESSAGE_TYPES = new Set<MessageRequest["type"]>([
  "HANDSHAKE",
  "GET_STATUS",
  "REQUEST_USER_ATTENTION",
  "CLEAR_WINDOW_ATTENTION",
  "EXECUTE_TOOL",
  "PREFLIGHT_TOOL",
  "APPROVE_TOOL",
  "SHOW_NOTIFICATION",
  "SYNC_CONFIG",
  "SET_LOG_VISIBLE",
  "SET_AUTO_SEND",
  "SET_AUTO_APPROVE_TOOLS",
  "SET_DEFAULT_AUTO_APPROVE_TOOLS",
]);

const SETTINGS_RUNTIME_MESSAGE_TYPES = new Set<MessageRequest["type"]>([
  "SET_LOG_VISIBLE",
  "SET_AUTO_SEND",
  "SET_AUTO_APPROVE_TOOLS",
  "SET_DEFAULT_AUTO_APPROVE_TOOLS",
]);

function isMessageRequestType(value: unknown): value is MessageRequest["type"] {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MESSAGE_REQUEST_VALIDATORS, value);
}

export function isMessageRequest(value: unknown): value is MessageRequest {
  return isRecord(value) &&
    isMessageRequestType(value.type) &&
    MESSAGE_REQUEST_VALIDATORS[value.type](value);
}

export function isBackgroundRuntimeMessageRequest(
  value: MessageRequest
): value is BackgroundRuntimeMessageRequest {
  return BACKGROUND_RUNTIME_MESSAGE_TYPES.has(value.type);
}

export function isSettingsRuntimeMessageRequest(
  value: BackgroundRuntimeMessageRequest
): value is SettingsRuntimeMessageRequest {
  return SETTINGS_RUNTIME_MESSAGE_TYPES.has(value.type);
}

export function isSuccessResponse(value: unknown): value is SuccessResponse {
  return isRecord(value) && typeof value.success === "boolean";
}

export function isStatusResponse(value: unknown): value is StatusResponse {
  return isRecord(value) && typeof value.connected === "boolean";
}

export function isSession(value: unknown): value is Session {
  return isStoredSession(value) &&
    typeof value.showLog === "boolean" &&
    typeof value.autoSend === "boolean" &&
    typeof value.autoApproveTools === "boolean" &&
    typeof value.workspaceId === "string";
}

export function isStoredSession(value: unknown): value is StoredSession {
  if (!isRecord(value)) {return false;}

  return typeof value.port === "number" &&
    typeof value.token === "string" &&
    hasValidStoredSessionOptions(value);
}

export function normalizeSession(value: unknown): Session | null {
  if (!isStoredSession(value)) {return null;}

  return {
    port: value.port,
    token: value.token,
    showLog: value.showLog ?? false,
    autoSend: value.autoSend ?? true,
    autoApproveTools: value.autoApproveTools ?? false,
    workspaceId: value.workspaceId ?? "global",
    lastGatewayActivityAt: value.lastGatewayActivityAt,
    gatewayIdleTimeoutMs: value.gatewayIdleTimeoutMs,
    siteId: value.siteId,
    targetOrigin: value.targetOrigin ?? value.allowedOrigins?.[0],
    targetUrl: value.targetUrl,
    allowedOrigins: value.allowedOrigins,
  };
}

export function isSiteSelectors(value: unknown): value is SiteSelectors {
  return isRecord(value) &&
    typeof value.messageBlocks === "string" &&
    typeof value.codeBlocks === "string" &&
    typeof value.inputArea === "string" &&
    typeof value.sendButton === "string" &&
    typeof value.stopButton === "string" &&
    (
      value.maxInlineChars === undefined ||
      typeof value.maxInlineChars === "number"
    ) &&
    (
      value.virtualizedMessages === undefined ||
      typeof value.virtualizedMessages === "boolean"
    );
}

export function isSyncedAiSite(value: unknown): value is SyncedAiSite {
  return isRecord(value) &&
    typeof value.id === "string" &&
    (
      value.name === undefined ||
      typeof value.name === "string"
    );
}

export function getSiteNetworkCaptureConfig(value: unknown): SiteNetworkCaptureConfig | null {
  return isSiteNetworkCaptureConfig(value) ? value : null;
}

export function getSyncedAiSites(value: unknown): SyncedAiSite[] {
  return Array.isArray(value) ? value.filter(isSyncedAiSite) : [];
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function isToolExecutionTransportPayload(value: unknown): value is ToolExecutionTransportPayload {
  return isRecord(value) &&
    typeof value.name === "string" &&
    (value.arguments === undefined || isRecord(value.arguments)) &&
    isOptionalString(value.purpose) &&
    isOptionalString(value.internal_call_id);
}

function hasValidStoredSessionOptions(value: Record<string, unknown>): boolean {
  return [value.showLog, value.autoSend, value.autoApproveTools].every(isOptionalBoolean) &&
    [value.workspaceId, value.siteId, value.targetOrigin, value.targetUrl].every(isOptionalString) &&
    [value.lastGatewayActivityAt, value.gatewayIdleTimeoutMs].every(isOptionalNumber) &&
    isOptionalStringArray(value.allowedOrigins);
}
