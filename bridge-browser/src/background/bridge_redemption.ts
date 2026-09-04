import { isRecord } from "../types";

export interface RedeemedBridgeSession {
  idleTimeoutMs: number;
  siteId: string;
  targetOrigin: string;
  targetUrl: string;
  token: string;
  vscodeExtensionVersion: string;
  workspaceId: string;
}

interface BridgeSessionPayload extends Record<string, unknown> {
  idleTimeoutMs: number;
  siteId: string;
  success: true;
  targetOrigin: string;
  targetUrl: string;
  token: string;
  vscodeExtensionVersion: string;
  workspaceId: string;
}

const REQUIRED_STRING_FIELDS = [
  "token",
  "siteId",
  "targetOrigin",
  "targetUrl",
  "vscodeExtensionVersion",
  "workspaceId",
] as const;

export function normalizeRedeemedBridgeSession(value: unknown): RedeemedBridgeSession | null {
  if (!isRecord(value) || !isBridgeSessionPayload(value)) {
    return null;
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(value.targetUrl);
  } catch {
    return null;
  }
  if (
    (parsedTarget.protocol !== "https:" && parsedTarget.protocol !== "http:") ||
    parsedTarget.origin !== value.targetOrigin
  ) {
    return null;
  }

  return {
    idleTimeoutMs: value.idleTimeoutMs,
    siteId: value.siteId,
    targetOrigin: value.targetOrigin,
    targetUrl: parsedTarget.href,
    token: value.token,
    vscodeExtensionVersion: value.vscodeExtensionVersion,
    workspaceId: value.workspaceId,
  };
}

export function getBridgeRedemptionError(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" && value.error.trim()
    ? value.error
    : "Bridge code expired or already used. Launch the site again from VS Code.";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBridgeSessionPayload(value: Record<string, unknown>): value is BridgeSessionPayload {
  return value.success === true &&
    REQUIRED_STRING_FIELDS.every((field) => isNonEmptyString(value[field])) &&
    typeof value.idleTimeoutMs === "number" &&
    Number.isFinite(value.idleTimeoutMs) &&
    value.idleTimeoutMs > 0;
}
