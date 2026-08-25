import { type Session, type ToolExecutionPayload } from '@webcode/shared';
import { type SiteSelectors } from './modules/config';

// Re-export shared types for convenience
export type { Session, ToolExecutionPayload };

// === Extension-Internal Types ===

export interface MessageRequest {
  type: string;
  tabId?: number;
  port?: number;
  token?: string;
  siteId?: string;
  targetOrigin?: string;
  targetUrl?: string;
  vscodeExtensionVersion?: string;
  browserExtensionVersion?: string;
  workspaceId?: string;
  force?: boolean;
  show?: boolean;
  title?: string;
  message?: string;
  onlyWhenWindowInBackground?: boolean;
  playSound?: boolean;
  connected?: boolean;
  autoSend?: boolean;
  autoApproveTools?: boolean;
  defaultAutoApproveTools?: boolean;
  payload?: ToolExecutionPayload;
  approvalToken?: string;
  challengeId?: string;
}

export interface HandshakeResponse {
  success: boolean;
  error?: string;
  conflictTabId?: string;
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

export function isMessageRequest(value: unknown): value is MessageRequest {
  return isRecord(value) && typeof value.type === "string";
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
    isOptionalBoolean(value.showLog) &&
    isOptionalBoolean(value.autoSend) &&
    isOptionalBoolean(value.autoApproveTools) &&
    isOptionalString(value.workspaceId) &&
    isOptionalNumber(value.lastGatewayActivityAt) &&
    isOptionalString(value.siteId) &&
    isOptionalString(value.targetOrigin) &&
    isOptionalString(value.targetUrl) &&
    isOptionalStringArray(value.allowedOrigins);
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
