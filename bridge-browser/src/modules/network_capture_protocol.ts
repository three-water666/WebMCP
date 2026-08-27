import {
  isSiteNetworkCaptureConfig,
  PROTOCOL,
  type SiteNetworkCaptureConfig,
} from "@webcode/shared";

export interface NetworkCaptureConfigMessage {
  capture: SiteNetworkCaptureConfig | null;
  token: string;
  type: typeof PROTOCOL.networkCaptureConfigMessage;
}

export interface NetworkCaptureReadyMessage {
  type: typeof PROTOCOL.networkCaptureReadyMessage;
}

interface NetworkCaptureEventBase {
  captureId: string;
  token: string;
  type: typeof PROTOCOL.networkCaptureEventMessage;
  url: string;
}

export interface NetworkCaptureStartedEvent extends NetworkCaptureEventBase {
  event: "started";
}

export interface NetworkCapturedToolCall {
  index: number;
  messageId: string;
  text: string;
}

export interface NetworkCaptureCompletedEvent extends NetworkCaptureEventBase {
  calls: NetworkCapturedToolCall[];
  conversationId?: string;
  event: "completed";
}

export interface NetworkCaptureFailedEvent extends NetworkCaptureEventBase {
  event: "failed";
  reason: string;
}

export type NetworkCapturePageEvent =
  | NetworkCaptureStartedEvent
  | NetworkCaptureCompletedEvent
  | NetworkCaptureFailedEvent;

export function isNetworkCaptureConfigMessage(value: unknown): value is NetworkCaptureConfigMessage {
  if (!isRecord(value) || value.type !== PROTOCOL.networkCaptureConfigMessage) {
    return false;
  }
  return typeof value.token === "string" &&
    (value.capture === null || isSiteNetworkCaptureConfig(value.capture));
}

export function isNetworkCaptureReadyMessage(value: unknown): value is NetworkCaptureReadyMessage {
  return isRecord(value) && value.type === PROTOCOL.networkCaptureReadyMessage;
}

export function isNetworkCapturePageEvent(value: unknown): value is NetworkCapturePageEvent {
  if (!hasEventBase(value)) {
    return false;
  }
  if (value.event === "started") {
    return true;
  }
  if (value.event === "failed") {
    return typeof value.reason === "string";
  }
  return value.event === "completed" &&
    (value.conversationId === undefined || typeof value.conversationId === "string") &&
    Array.isArray(value.calls) &&
    value.calls.every(isCapturedToolCall);
}

function hasEventBase(value: unknown): value is Record<string, unknown> & NetworkCaptureEventBase {
  return isRecord(value) &&
    value.type === PROTOCOL.networkCaptureEventMessage &&
    typeof value.captureId === "string" &&
    typeof value.token === "string" &&
    typeof value.url === "string";
}

function isCapturedToolCall(value: unknown): value is NetworkCapturedToolCall {
  return isRecord(value) &&
    Number.isInteger(value.index) &&
    Number(value.index) >= 0 &&
    typeof value.messageId === "string" &&
    typeof value.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
