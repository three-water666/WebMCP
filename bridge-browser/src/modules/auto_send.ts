import { type SiteSelectors } from "./config";
import { t } from "./i18n";
import { Logger } from "./logger";
import {
  getInputAreaElement,
  getSendButton,
  isSendButtonActuallyStopButton,
  isStopButtonVisible,
} from "./page_selectors";
import { isElementVisible } from "./dom_helpers";
import { showUserAttentionNotification } from "./user_attention";

type AutoSendAction = "ctrl-enter" | "enter" | "button";
export type AutoSendResult = "cancelled" | "disabled" | "failed" | "sent";

interface ActiveAutoSend {
  cancel: (shouldLog: boolean) => void;
  timer: NodeJS.Timeout | null;
}

let activeAutoSend: ActiveAutoSend | null = null;

const AUTO_SEND_INITIAL_DELAY_MS = 350;
const AUTO_SEND_SETTLE_MS = 1200;
const AUTO_SEND_RETRY_MS = 1600;
const AUTO_SEND_ACTIONS: AutoSendAction[] = [
  "enter",
  "ctrl-enter",
  "button",
  "enter",
  "ctrl-enter",
];

/**
 * 终止当前正在进行的自动发送轮询机制
 * @description 如果定时器存在，清除它并输出取消日志。主要用于当监听到用户手动输入或页面有新活动时，打断之前的自动发送操作。
 */
export function cancelAutoSend() {
  activeAutoSend?.cancel(true);
}

// === 自动发送逻辑 ===
/**
 * 触发智能自动发送（轮询重试机制）
 * @param config 用户插件配置 (如 autoSend: boolean)
 * @param domSelectors 网页对应选择器配置对象 (从 settings/init 下发)
 * @description
 * - 这是发送消息的核心自动机制，它会尝试使用各种可用的方法让当前网页端把回复消息“按出去”。
 * - 初始化时它将清理掉上一次的回车尝试，保证只留一个定时器运作。
 * - 每过 `1000~2000ms`，尝试寻找和触发当前网页的发送方式：
 * - 1. 优先分发一次基于回车键的 `KeyboardEvent`（Ctrl+Enter 和 Enter 分轮次尝试）。
 * - 2. 等待页面完成输入框清空、停止按钮切换等异步渲染。
 * - 3. 如果检测到发送成功，马上停止定时器；否则下一轮才尝试发送按钮。
 * - 4. 如果所有轮次还是失败，系统会弹出通知警告用户。
 */
export function triggerAutoSend(
  config: { autoSend: boolean },
  domSelectors: SiteSelectors
): Promise<AutoSendResult> {
  if (!config.autoSend) {return Promise.resolve("disabled");}
  activeAutoSend?.cancel(false);

  let retryCount = 0;
  const maxRetries = AUTO_SEND_ACTIONS.length;

  const getInputEl = () => getInputAreaElement(domSelectors);
  const getInputValue = (inputEl: HTMLElement): string => {
    if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
      return inputEl.value;
    }
    return inputEl.innerText;
  };
  const isSendComplete = () => {
    const latestInput = getInputEl();
    if (latestInput && getInputValue(latestInput).trim().length === 0) {
      return true;
    }

    return isStopButtonVisible(domSelectors);
  };

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: AutoSendResult, shouldLogCancellation = false) => {
      if (settled) {return;}
      settled = true;
      if (activeAutoSend?.timer) {clearTimeout(activeAutoSend.timer);}
      activeAutoSend = null;
      if (shouldLogCancellation && result === "cancelled") {
        Logger.log("🚫 Auto-send cancelled (New activity detected)", "warn");
      }
      resolve(result);
    };

    const schedule = (callback: () => void, delayMs: number) => {
      const timer = setTimeout(() => {
        if (activeAutoSend?.timer === timer) {activeAutoSend.timer = null;}
        callback();
      }, delayMs);
      if (activeAutoSend) {activeAutoSend.timer = timer;}
    };

    const scheduleRetry = () => {
      retryCount++;
      if (retryCount < maxRetries) {
        schedule(trySend, AUTO_SEND_RETRY_MS);
      } else {
        Logger.log(t("auto_send_timeout"), "error");
        void showUserAttentionNotification({
          title: "Auto-Send Failed",
          message: "Could not send message.",
        });
        finish("failed");
      }
    };

    const trySend = () => {
      const inputEl = getInputEl();
      if (inputEl) {inputEl.focus();}

      if (isSendComplete()) {
        Logger.log(t("send_success_cleared"), "success");
        finish("sent");
        return;
      }

      dispatchSendAttempt(inputEl, domSelectors, retryCount);
      // 等待页面完成输入框清空、stop 按钮切换等异步渲染；下一轮才尝试另一种发送方式。
      schedule(() => {
        if (isSendComplete()) {
          Logger.log(t("send_success_cleared"), "success");
          finish("sent");
          return;
        }
        scheduleRetry();
      }, AUTO_SEND_SETTLE_MS);
    };

    activeAutoSend = {
      cancel: (shouldLog) => finish(isSendComplete() ? "sent" : "cancelled", shouldLog),
      timer: null,
    };
    schedule(trySend, AUTO_SEND_INITIAL_DELAY_MS);
  });
}

function dispatchSendAttempt(
  inputEl: HTMLElement | null,
  domSelectors: SiteSelectors,
  retryCount: number
): void {
  if (inputEl) {
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const action = AUTO_SEND_ACTIONS[retryCount] ?? "enter";
  if (action === "ctrl-enter" || action === "enter") {
    if (!inputEl) {
      Logger.log(t("input_not_found"), "error");
      return;
    }
    const withCtrl = action === "ctrl-enter";
    triggerSingleEnter(inputEl, withCtrl);
    Logger.log(`Auto-send fallback: ${withCtrl ? "Ctrl+Enter" : "Enter"} (${retryCount + 1})`, "action");
    return;
  }

  const btnNow = getSendButton(domSelectors);
  if (isSendButtonReady(btnNow)) {
    if (!isSendButtonActuallyStopButton(domSelectors, btnNow)) {
      triggerButtonSend(btnNow);
      Logger.log(`${t("auto_send_attempt")} (${retryCount + 1})`, "action");
    }
  } else if (!btnNow) {
    Logger.log(t("send_btn_missing"), "warn");
  } else {
    Logger.log(t("send_btn_disabled"), "warn");
  }
}

/**
 * 确认当前发现的发送按钮是不是真的“激活”
 * @param btn 发现的发送 HTMLButtonElement
 * @returns 它是有效的按钮则返回 `true`，如果是 `disabled`，`aria-disabled` 或者不可见的则返回 `false`
 */
function isSendButtonReady(btn: HTMLButtonElement | null): btn is HTMLButtonElement {
  if (!btn) {return false;}
  if (btn.disabled) {return false;}
  if (btn.getAttribute("aria-disabled") === "true") {return false;}

  return isElementVisible(btn);
}

/**
 * 发送一组真实的鼠标交互事件来强行触发按钮被点击的效果
 * @param btn 待点击的网页发送按钮
 * @returns 始终返回 `true` 代表动作执行结束。但不能保证网页侧逻辑正确发了。
 * @description
 * - 针对许多采用 `React/Vue/Svelte` 单页面应用的特性，单独的 `click()` 可能无法触发业务上的响应，甚至被拦截或者需要搭配 mouseDown。
 * - 为了更高的兼容率，派发一系列从按下鼠标到松开的完整 `MouseEvent` 组合： `pointerdown`, `mousedown`, `pointerup`, `mouseup`, 接着执行最后点击。
 */
function triggerButtonSend(btn: HTMLElement): boolean {
  btn.focus();
  const mouseEventTypes: Array<"pointerdown" | "mousedown" | "pointerup" | "mouseup"> = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
  ];

  for (const type of mouseEventTypes) {
    btn.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }

  // btn.click() itself dispatches one click event; avoid dispatching a second synthetic click above.
  btn.click();
  return true;
}

/**
 * 主动抛出单独的 “回车键” 或 “Ctrl+回车键” 以尝试发送
 * @param inputEl 需要被回车事件触发的网页聊天输入框
 * @param withCtrl 若是 `true` 抛出带 Ctrl 的 Enter，否则是不带修饰键的 Enter
 * @description
 * - 针对许多采用 `React/Vue/Svelte` 的 AI 平台由于不支持普通的按钮点击（或无法选中按钮）导致发送失败。
 * - 该机制直接把 `keydown`, `keypress` 和 `keyup` 的事件连击强塞给聊天输入框，以此模拟人类“按下回车”。
 */
function triggerSingleEnter(inputEl: HTMLElement, withCtrl: boolean) {
  inputEl.focus();
  const init: KeyboardEventInit = {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    ctrlKey: withCtrl,
    shiftKey: false
  };
  inputEl.dispatchEvent(new KeyboardEvent("keydown", init));
  inputEl.dispatchEvent(new KeyboardEvent("keypress", init));
  inputEl.dispatchEvent(new KeyboardEvent("keyup", init));
}
