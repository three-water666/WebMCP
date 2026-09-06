import { BRANDING } from '@webcode/shared';

import { type ShowNotificationMessageRequest } from '../types';
import { getErrorMessage } from './errors';

const NOTIFICATION_ID_PREFIX = "webcode-tab";
const NOTIFICATION_CLICK_KEEPALIVE_INTERVAL_MS = 20_000;
const NOTIFICATION_CLICK_KEEPALIVE_TIMEOUT_MS = 60_000;

export async function updateWindowAttention(
  sender: chrome.runtime.MessageSender,
  drawAttention: boolean
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  const windowId = sender.tab?.windowId;
  if (typeof windowId !== "number" || windowId === chrome.windows.WINDOW_ID_NONE) {
    return { success: false, error: "Missing Window ID" };
  }

  try {
    if (drawAttention) {
      const targetWindow = await chrome.windows.get(windowId);
      if (targetWindow.focused) {
        return { success: true, skipped: true };
      }
    }

    await chrome.windows.update(windowId, { drawAttention });
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function showNotification(
  request: ShowNotificationMessageRequest,
  sender: chrome.runtime.MessageSender
): Promise<{ success: boolean; skipped?: boolean; notificationId?: string; error?: string }> {
  try {
    if (request.onlyWhenWindowInBackground) {
      const shouldShowNotification = await shouldShowNotificationForSender(sender);
      if (!shouldShowNotification) {
        return { success: true, skipped: true };
      }
    }

    const notificationId = await createNotification(request, sender);

    return { success: true, notificationId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

async function shouldShowNotificationForSender(sender: chrome.runtime.MessageSender): Promise<boolean> {
  try {
    const windowId = sender.tab?.windowId;
    if (typeof windowId !== "number" || windowId === chrome.windows.WINDOW_ID_NONE) {
      return true;
    }

    const targetWindow = await chrome.windows.get(windowId);
    if (targetWindow.focused === false || targetWindow.state === "minimized") {
      return true;
    }

    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return false;
    }

    const targetTab = await chrome.tabs.get(tabId);
    return targetTab.active === false;
  } catch {
    return true;
  }
}

function createNotification(
  request: ShowNotificationMessageRequest,
  sender: chrome.runtime.MessageSender
): Promise<string> {
  return new Promise((resolve, reject) => {
    const notificationId = createNotificationId(sender);
    chrome.notifications.create(
      notificationId,
      {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: request.title ?? BRANDING.notificationName,
        message: request.message ?? "Task Completed",
        priority: 2,
      },
      (createdNotificationId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(createdNotificationId);
      }
    );
  });
}

function createNotificationId(sender: chrome.runtime.MessageSender): string {
  const tabId = sender.tab?.id;
  const tabPart = typeof tabId === "number" ? String(tabId) : "none";
  const uniquePart = Math.random().toString(36).slice(2, 8);
  return `${NOTIFICATION_ID_PREFIX}-${tabPart}-${Date.now()}-${uniquePart}`;
}

function getNotificationSourceTabId(notificationId: string): number | null {
  const match = notificationId.match(new RegExp(`^${NOTIFICATION_ID_PREFIX}-(\\d+)-`));
  if (!match) {return null;}

  const tabId = Number(match[1]);
  return Number.isInteger(tabId) ? tabId : null;
}

export async function focusNotificationSourceTab(notificationId: string): Promise<void> {
  try {
    const tabId = getNotificationSourceTabId(notificationId);
    if (tabId === null) {return;}

    const tab = await chrome.tabs.update(tabId, { active: true });

    if (typeof tab.windowId === "number" && tab.windowId !== chrome.windows.WINDOW_ID_NONE) {
      await focusWindow(tab.windowId);
    }
  } catch (error) {
    console.warn(`${BRANDING.logPrefix} Failed to focus notification source tab:`, error);
  } finally {
    chrome.notifications.clear(notificationId, () => {
      void chrome.runtime.lastError;
    });
  }
}

export function handleNotificationClicked(notificationId: string): void {
  // MV3 notification click handlers cannot await this async tab/window focus chain.
  // Keep the service worker alive briefly, with a hard timeout to avoid leaks.
  const keepAliveInterval = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, NOTIFICATION_CLICK_KEEPALIVE_INTERVAL_MS);
  const keepAliveTimeout = setTimeout(() => {
    clearInterval(keepAliveInterval);
  }, NOTIFICATION_CLICK_KEEPALIVE_TIMEOUT_MS);

  void focusNotificationSourceTab(notificationId).finally(() => {
    clearInterval(keepAliveInterval);
    clearTimeout(keepAliveTimeout);
  });
}

async function focusWindow(windowId: number): Promise<void> {
  const targetWindow = await chrome.windows.get(windowId);
  if (targetWindow.state === "minimized") {
    await chrome.windows.update(windowId, { state: "normal" });
  }

  await chrome.windows.update(windowId, {
    drawAttention: false,
    focused: true,
  });
}
