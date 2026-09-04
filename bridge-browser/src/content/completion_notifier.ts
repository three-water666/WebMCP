import { BRANDING } from "@webcode/shared";
import { type SiteSelectors } from "../modules/config";
import { Logger } from "../modules/logger";
import { getMessageBlockElements, isStopButtonVisible } from "../modules/page_selectors";
import { looksLikeToolCall } from "../modules/toolCallProtocol";
import { showUserAttentionNotification } from "../modules/user_attention";

interface LatestResponseSnapshot {
  signature: string;
  hasContent: boolean;
  hasToolCall: boolean;
}

interface CompletionNotifierOptions {
  onCompletedWithoutTools?: () => void;
}

const NO_RESPONSE_SIGNATURE = "no-response";
const COMPLETION_SETTLE_MS = 600;
const COMPLETION_NOTIFICATION_COOLDOWN_MS = 1000;
const MAX_NOTIFIED_COMPLETION_KEYS = 200;

export class CompletionNotifier {
  private lastIdle: boolean | null = null;
  private pendingStartSignature: string | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotificationTime = 0;
  private readonly notifiedCompletionKeys = new Set<string>();

  public constructor(private readonly options: CompletionNotifierOptions = {}) {}

  public reset(): void {
    this.clearCompletionTimer();
    this.lastIdle = null;
    this.pendingStartSignature = null;
    this.lastNotificationTime = 0;
    this.notifiedCompletionKeys.clear();
  }

  public observe(domSelectors: SiteSelectors): void {
    const isIdle = isCompletionIdle(domSelectors);
    if (this.lastIdle === null) {
      this.lastIdle = isIdle;
      if (!isIdle) {
        this.pendingStartSignature = getLatestResponseSnapshot(domSelectors)?.signature ?? NO_RESPONSE_SIGNATURE;
      }
      return;
    }

    if (this.lastIdle && !isIdle) {
      this.clearCompletionTimer();
      this.pendingStartSignature = getLatestResponseSnapshot(domSelectors)?.signature ?? NO_RESPONSE_SIGNATURE;
    }

    if (!this.lastIdle && isIdle) {
      this.scheduleCompletionCheck(domSelectors);
    }

    this.lastIdle = isIdle;
  }

  private scheduleCompletionCheck(domSelectors: SiteSelectors): void {
    this.clearCompletionTimer();
    this.completionTimer = setTimeout(() => {
      this.completionTimer = null;
      if (!isCompletionIdle(domSelectors)) {
        return;
      }

      this.notifyIfCurrentTurnCompletedWithoutTools(domSelectors);
    }, COMPLETION_SETTLE_MS);
  }

  private notifyIfCurrentTurnCompletedWithoutTools(domSelectors: SiteSelectors): void {
    const startSignature = this.pendingStartSignature;
    this.pendingStartSignature = null;
    if (startSignature === null) {
      return;
    }

    const snapshot = getLatestResponseSnapshot(domSelectors);
    if (!snapshot || !snapshot.hasContent || snapshot.hasToolCall) {
      return;
    }

    if (snapshot.signature === startSignature) {
      return;
    }

    const completionKey = `${startSignature}->${snapshot.signature}`;
    if (this.notifiedCompletionKeys.has(completionKey)) {
      return;
    }

    this.notifiedCompletionKeys.add(completionKey);
    this.options.onCompletedWithoutTools?.();
    if (this.notifiedCompletionKeys.size > MAX_NOTIFIED_COMPLETION_KEYS) {
      const oldestKey = this.notifiedCompletionKeys.values().next().value;
      if (typeof oldestKey === "string") {
        this.notifiedCompletionKeys.delete(oldestKey);
      }
    }

    const now = Date.now();
    if (now - this.lastNotificationTime < COMPLETION_NOTIFICATION_COOLDOWN_MS) {
      return;
    }

    this.lastNotificationTime = now;

    void requestCompletionAttention().then((result) => {
      if (result === "sent") {
        Logger.log("Completion attention requested", "action");
      } else if (result === "failed") {
        Logger.log("Completion attention request failed", "info");
      }
    });
  }

  private clearCompletionTimer(): void {
    if (!this.completionTimer) {
      return;
    }

    clearTimeout(this.completionTimer);
    this.completionTimer = null;
  }
}

function isCompletionIdle(domSelectors: SiteSelectors): boolean {
  return !isStopButtonVisible(domSelectors);
}

function getLatestResponseSnapshot(domSelectors: SiteSelectors): LatestResponseSnapshot | null {
  const messages = getMessageBlockElements(domSelectors);
  if (messages.length === 0) {
    return null;
  }

  const messageIndex = messages.length - 1;
  const messageElement = messages[messageIndex];
  const text = (messageElement.textContent ?? "").trim();
  const codeElements = Array.from(messageElement.querySelectorAll(domSelectors.codeBlocks));

  return {
    signature: `${messageIndex}:${hashStableString(text)}`,
    hasContent: text.length > 0,
    hasToolCall: codeElements.some((codeEl) => looksLikeToolCall((codeEl.textContent ?? "").trim())),
  };
}

function requestCompletionAttention(): Promise<"sent" | "skipped" | "failed"> {
  return showUserAttentionNotification({
    title: BRANDING.notificationName,
    message: "Task Completed",
    onlyWhenWindowInBackground: true,
  });
}

function hashStableString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
