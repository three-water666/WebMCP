import { BRANDING, PROTOCOL } from '@webcode/shared';

import type { SessionDisconnectReason } from '../types';
import { updateBadge } from './badge';
import {
  getCurrentProtocolSession,
  getStoredSessionTabIds,
  removeSession,
  updateSessionGatewayActivity,
  type CurrentProtocolSession,
} from './sessions';

export type GatewayHealthStatus = "online" | "offline" | "unauthorized";

const GATEWAY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const GATEWAY_IDLE_GRACE_MS = 10 * 1000;
const GATEWAY_IDLE_RECHECK_MS = 60 * 1000;
const GATEWAY_HEALTH_TIMEOUT_MS = 2500;
const SESSION_EXPIRY_ALARM_PREFIX = "webcode-session-expiry:";

export async function checkGatewayHealth(
  session: Pick<CurrentProtocolSession, "port" | "token">
): Promise<GatewayHealthStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GATEWAY_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${session.port}/v1/status`, {
      cache: "no-store",
      headers: { [PROTOCOL.authHeaderName]: session.token },
      signal: controller.signal,
    });

    if (response.ok) {
      return "online";
    }

    return response.status === 403 ? "unauthorized" : "offline";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function recordGatewayActivity(tabId: number): Promise<void> {
  const session = await updateSessionGatewayActivity(tabId);
  if (session) {
    scheduleSessionExpiryCheck(
      tabId,
      session.lastGatewayActivityAt,
      session.gatewayIdleTimeoutMs
    );
  }
}

export function scheduleSessionExpiryCheck(
  tabId: number,
  lastGatewayActivityAt?: number,
  gatewayIdleTimeoutMs?: number
): void {
  const activityAt = getValidTimestamp(lastGatewayActivityAt) ?? Date.now();
  const expiresAt = activityAt + getGatewayIdleTimeoutMs(gatewayIdleTimeoutMs) + GATEWAY_IDLE_GRACE_MS;
  const delayMs = Math.max(1000, expiresAt - Date.now());

  void chrome.alarms.create(getSessionExpiryAlarmName(tabId), {
    delayInMinutes: delayMs / 60000,
  });
}

export async function clearSessionExpiryCheck(tabId: number): Promise<void> {
  await chrome.alarms.clear(getSessionExpiryAlarmName(tabId));
}

export async function expireGatewaySession(
  tabId: number,
  reason: SessionDisconnectReason
): Promise<void> {
  await clearSessionExpiryCheck(tabId);
  await removeSession(tabId, reason);
}

export async function scheduleStoredSessionExpiryChecks(): Promise<void> {
  const tabIds = await getStoredSessionTabIds();
  await Promise.all(tabIds.map(scheduleStoredSessionExpiryCheck));
}

export async function handleSessionExpiryAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  const tabId = getTabIdFromSessionExpiryAlarm(alarm.name);
  if (!tabId) {
    return;
  }

  const session = await getCurrentProtocolSession(tabId);
  if (!session) {
    updateBadge(tabId, false);
    await clearSessionExpiryCheck(tabId);
    return;
  }

  const expiresAt = getSessionExpiresAt(session);
  if (Date.now() < expiresAt) {
    scheduleSessionExpiryCheck(tabId, session.lastGatewayActivityAt, session.gatewayIdleTimeoutMs);
    return;
  }

  const status = await checkGatewayHealth(session);
  if (status === "online") {
    rescheduleSessionExpiryRecheck(tabId);
    return;
  }

  console.log(`${BRANDING.logPrefix} Gateway session expired for tab ${tabId}: ${status}`);
  await expireGatewaySession(tabId, getDisconnectReasonForHealthStatus(status));
}

async function scheduleStoredSessionExpiryCheck(tabId: number): Promise<void> {
  const session = await getCurrentProtocolSession(tabId);
  if (session) {
    scheduleSessionExpiryCheck(tabId, session.lastGatewayActivityAt, session.gatewayIdleTimeoutMs);
  }
}

function rescheduleSessionExpiryRecheck(tabId: number): void {
  void chrome.alarms.create(getSessionExpiryAlarmName(tabId), {
    delayInMinutes: GATEWAY_IDLE_RECHECK_MS / 60000,
  });
}

function getSessionExpiresAt(session: CurrentProtocolSession): number {
  const activityAt = getValidTimestamp(session.lastGatewayActivityAt) ?? Date.now();
  return activityAt + getGatewayIdleTimeoutMs(session.gatewayIdleTimeoutMs) + GATEWAY_IDLE_GRACE_MS;
}

function getSessionExpiryAlarmName(tabId: number): string {
  return `${SESSION_EXPIRY_ALARM_PREFIX}${tabId}`;
}

function getTabIdFromSessionExpiryAlarm(alarmName: string): number | null {
  if (!alarmName.startsWith(SESSION_EXPIRY_ALARM_PREFIX)) {
    return null;
  }

  const tabId = Number(alarmName.slice(SESSION_EXPIRY_ALARM_PREFIX.length));
  return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
}

function getDisconnectReasonForHealthStatus(status: GatewayHealthStatus): SessionDisconnectReason {
  return status === "unauthorized" ? "invalid_token" : "gateway_unavailable";
}

function getValidTimestamp(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function getGatewayIdleTimeoutMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : GATEWAY_IDLE_TIMEOUT_MS;
}
