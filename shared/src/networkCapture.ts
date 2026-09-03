export const NETWORK_CAPTURE_ADAPTERS = ["chatgpt-delta-v1", "deepseek-chat-v0"] as const;
export const NETWORK_CAPTURE_STRATEGIES = ["network-preferred"] as const;
export const NETWORK_CAPTURE_TRANSPORTS = ["fetch-sse", "xhr-sse"] as const;
export const NETWORK_CAPTURE_METHODS = ["GET", "POST"] as const;

export type NetworkCaptureAdapter = typeof NETWORK_CAPTURE_ADAPTERS[number];
export type NetworkCaptureStrategy = typeof NETWORK_CAPTURE_STRATEGIES[number];
export type NetworkCaptureTransport = typeof NETWORK_CAPTURE_TRANSPORTS[number];
export type NetworkCaptureMethod = typeof NETWORK_CAPTURE_METHODS[number];

export interface SiteNetworkCaptureConfig {
  adapter: NetworkCaptureAdapter;
  channels: string[];
  enabled: boolean;
  method: NetworkCaptureMethod;
  strategy: NetworkCaptureStrategy;
  transport: NetworkCaptureTransport;
  url: string;
}

export function isSiteNetworkCaptureConfig(value: unknown): value is SiteNetworkCaptureConfig {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.enabled === "boolean" &&
    NETWORK_CAPTURE_STRATEGIES.includes(value.strategy as NetworkCaptureStrategy) &&
    NETWORK_CAPTURE_TRANSPORTS.includes(value.transport as NetworkCaptureTransport) &&
    NETWORK_CAPTURE_METHODS.includes(value.method as NetworkCaptureMethod) &&
    NETWORK_CAPTURE_ADAPTERS.includes(value.adapter as NetworkCaptureAdapter) &&
    typeof value.url === "string" &&
    value.url.trim().length > 0 &&
    Array.isArray(value.channels) &&
    value.channels.length > 0 &&
    value.channels.every((channel) => typeof channel === "string" && channel.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
