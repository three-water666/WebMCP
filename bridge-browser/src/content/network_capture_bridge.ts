import { PROTOCOL, type SiteNetworkCaptureConfig } from "@webcode/shared";
import {
  isNetworkCapturePageEvent,
  isNetworkCaptureReadyMessage,
  type NetworkCaptureCompletedEvent,
  type NetworkCaptureConfigMessage,
  type NetworkCapturePageEvent,
} from "../modules/network_capture_protocol";

interface NetworkCaptureBridgeOptions {
  onCompleted: (event: NetworkCaptureCompletedEvent) => boolean;
  onFallbackNeeded: () => void;
}

const MAX_HANDLED_CAPTURE_IDS = 100;

export class NetworkCaptureBridge {
  private readonly activeCaptureIds = new Set<string>();
  private readonly handledCaptureIds = new Set<string>();
  private readonly token = createCaptureToken();
  private captureConfig: SiteNetworkCaptureConfig | null = null;
  private latestTurnOwnedByNetwork = false;

  public constructor(private readonly options: NetworkCaptureBridgeOptions) {
    window.addEventListener("message", (event: MessageEvent<unknown>) => this.handlePageMessage(event));
  }

  public configure(capture: SiteNetworkCaptureConfig | null): void {
    this.captureConfig = capture?.enabled ? capture : null;
    this.activeCaptureIds.clear();
    this.latestTurnOwnedByNetwork = false;
    this.postConfig();
  }

  public shouldSuppressDomCapture(): boolean {
    return this.activeCaptureIds.size > 0 || this.latestTurnOwnedByNetwork;
  }

  private postConfig(): void {
    const message: NetworkCaptureConfigMessage = {
      capture: this.captureConfig,
      token: this.token,
      type: PROTOCOL.networkCaptureConfigMessage,
    };
    window.postMessage(message, window.location.origin);
  }

  private handlePageMessage(event: MessageEvent<unknown>): void {
    if (event.source !== window) {
      return;
    }
    if (isNetworkCaptureReadyMessage(event.data)) {
      this.postConfig();
      return;
    }
    const captureEvent = this.getValidatedCaptureEvent(event.data);
    if (!captureEvent) {
      return;
    }

    this.handleCaptureEvent(captureEvent);
  }

  private getValidatedCaptureEvent(value: unknown): NetworkCapturePageEvent | null {
    if (!this.captureConfig || !isNetworkCapturePageEvent(value)) {
      return null;
    }
    return value.token === this.token && urlsMatch(value.url, this.captureConfig.url)
      ? value
      : null;
  }

  private handleCaptureEvent(event: NetworkCapturePageEvent): void {
    if (event.event === "started") {
      this.activeCaptureIds.add(event.captureId);
      this.latestTurnOwnedByNetwork = true;
      return;
    }
    if (!this.activeCaptureIds.delete(event.captureId) || this.wasHandled(event.captureId)) {
      return;
    }

    this.rememberHandled(event.captureId);
    if (event.event === "completed") {
      this.latestTurnOwnedByNetwork = this.options.onCompleted(event);
    } else if (this.activeCaptureIds.size === 0) {
      this.latestTurnOwnedByNetwork = false;
    }

    if (!this.shouldSuppressDomCapture()) {
      this.options.onFallbackNeeded();
    }
  }

  private wasHandled(captureId: string): boolean {
    return this.handledCaptureIds.has(captureId);
  }

  private rememberHandled(captureId: string): void {
    this.handledCaptureIds.add(captureId);
    if (this.handledCaptureIds.size <= MAX_HANDLED_CAPTURE_IDS) {
      return;
    }
    const oldest = this.handledCaptureIds.values().next().value;
    if (typeof oldest === "string") {
      this.handledCaptureIds.delete(oldest);
    }
  }
}

function urlsMatch(actualValue: string, configuredValue: string): boolean {
  try {
    const actual = new URL(actualValue, window.location.href);
    const configured = new URL(configuredValue, window.location.href);
    return actual.origin === configured.origin && normalizePath(actual.pathname) === normalizePath(configured.pathname);
  } catch {
    return false;
  }
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function createCaptureToken(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
