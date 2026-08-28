import { BRANDING } from "@webcode/shared";
import { type SiteSelectors } from "./config";
import { i18n, t } from "./i18n";
import { Logger } from "./logger";
import { delay } from "./dom_helpers";
import { getInputAreaBySelector, getInputAreaElement } from "./page_selectors";
import { showUserAttentionNotification } from "./user_attention";
import {
  buildAttachmentFailureReason,
  createTextAttachmentFile,
  isPasteEventAcknowledged,
  prepareAttachmentGroups,
  toAttachmentFailure,
} from "./attachment_delivery";
import {
  applyAttachmentDeliveryFailures,
  type ToolResultAttachmentFailure,
  type ToolResultAttachmentGroup,
  type ToolResultDeliveryBatch,
} from "./tool_result";

export interface DeliverResultStatus {
  /** Historical flag: true means at least one file paste event was dispatched. */
  uploaded: boolean;
  delivered: boolean;
  attemptedWrite: boolean;
  attemptedUpload: boolean;
}

interface InputWriteResult {
  delivered: boolean;
  attemptedWrite: boolean;
}

export interface AttachmentPasteDispatchResult {
  acknowledged: boolean;
  dispatched: boolean;
  reason?: string;
}

const INPUT_WRITE_VERIFY_DELAYS_MS = [120, 250, 500];
const TOOL_ATTACHMENT_SETTLE_MS = 2000;
const LEGACY_ATTACHMENT_SETTLE_MS = 800;

// === 回填输入框 ===
/**
 * 将工具执行的结果回填到网页内的主要输入框（聊天框）中
 * @param text 要回填的文本字符串
 * @param inputSelector 网页对应输入框的 DOM 选择器
 * @description
 * - 寻找目标输入区域，读取已有内容并按需附加空行进行拼接。
 * - 尝试使用 `document.execCommand("insertText")` 安全地将文字插入到输入框，这能最好地触发 React/Vue 的变更检测。
 * - 作为备选（Fail-safe），如果 `execCommand` 失败，则回退直接赋值，并手动 dispatch `input` 事件触发框架数据更新。
 */
export function writeToInputBox(text: string, inputSelector: string): void {
  const inputEl = getInputAreaBySelector(inputSelector);
  if (!inputEl) {
    Logger.log(t("input_not_found"), "error");
    return;
  }

  const final = buildFinalInputText(inputEl, text);

  setInputBoxText(final, inputEl);
  Logger.log(t("result_written"), "action");
}

export function replaceInputBoxText(text: string, inputSelector: string): boolean {
  const inputEl = getInputAreaBySelector(inputSelector);
  if (!inputEl) {
    Logger.log(t("input_not_found"), "error");
    return false;
  }

  setInputBoxText(text, inputEl);
  return true;
}

function setInputBoxText(text: string, inputEl: HTMLElement | HTMLInputElement | HTMLTextAreaElement, forceFallback = false) {
  inputEl.focus();
  let success = false;

  if (!forceFallback) {
    try {
      const selected = document.execCommand("selectAll", false);
      success = selected && document.execCommand("insertText", false, text);
    } catch {
    }
  }

  if (!success) {
    if (isTextControl(inputEl)) {
      setTextControlValue(inputEl, text);
    } else {
      inputEl.innerText = text;
    }
  }

  inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  inputEl.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * 将工具执行的结果分发交付给聊天页面输入框
 * @param resultBatch 要发送的分组工具结果及其附件
 * @param domSelectors 网页对应选择器配置对象 (从 settings/init 下发)
 * @returns 包含交付状态的 Promise 对象，表示是否派发附件 paste、是否确认写入输入框、以及尝试过哪些动作
 * @description
 * - 这是一个关键的分发函数，它会自动判断内容是否超过了内联文本的最大限制(`maxInlineChars`)。
 * - 如果超过了限制且平台支持作为附件上传，它将尝试调用对应的上传函数 (`paste` 模式)。
 * - 如果附件模式上传成功，它会将内容提取到文本文件里，并在输入框中写下简短的提示语引导 AI 读取附件。
 * - 工具附件粘贴后会固定等待两秒，再交给已有的自动发送重试机制。
 * - 如果超长文本附件上传失败，它会安全地回退，把全部结果拼接到输入框里。
 */
export async function deliverResult(
  resultBatch: ToolResultDeliveryBatch,
  domSelectors: SiteSelectors
): Promise<DeliverResultStatus> {
  if (resultBatch.attachmentGroups.length > 0) {
    return deliverResultWithAttachments(resultBatch, domSelectors);
  }

  return deliverTextResult(resultBatch.output, domSelectors);
}

async function deliverTextResult(text: string, domSelectors: SiteSelectors): Promise<DeliverResultStatus> {
  const maxInlineChars = typeof domSelectors.maxInlineChars === "number"
    ? domSelectors.maxInlineChars
    : 0;
  const inputEl = getInputAreaElement(domSelectors);
  const finalInlineText = inputEl ? buildFinalInputText(inputEl, text) : text;
  const finalInlineLength = finalInlineText.length;

  if (!maxInlineChars || finalInlineLength <= maxInlineChars) {
    const writeResult = await writeToInputBoxWithVerification(text, domSelectors.inputArea);
    if (!writeResult.delivered) {
      notifyResultDeliveryFailure(false);
    }
    return toDeliveryStatus(false, writeResult, false);
  }

  const pasteDispatched = await pasteTextAsAttachment(text, domSelectors);

  if (!pasteDispatched) {
    Logger.log("Attachment paste dispatch failed. Falling back to inline result.", "warn");
    const writeResult = await writeToInputBoxWithVerification(text, domSelectors.inputArea);
    if (!writeResult.delivered) {
      notifyResultDeliveryFailure(false);
    }
    return toDeliveryStatus(false, writeResult, false);
  }

  Logger.log(`Dispatched oversized result TXT paste (${finalInlineLength} chars inline)`, "action");

  // Also provide a textual indication inside the input box to the LLM
  const oversizePrompt = i18n.resources.oversize ?? `The result exceeds the character limit. It has been attached as a text file. Please read the attached file for the full details.`;
  const writeResult = await writeToInputBoxWithVerification(oversizePrompt, domSelectors.inputArea);
  if (!writeResult.delivered) {
    notifyResultDeliveryFailure(true);
  }

  return toDeliveryStatus(true, writeResult, true);
}

async function deliverResultWithAttachments(
  resultBatch: ToolResultDeliveryBatch,
  domSelectors: SiteSelectors
): Promise<DeliverResultStatus> {
  const prepared = prepareAttachmentGroups(resultBatch.attachmentGroups);
  const failures: ToolResultAttachmentFailure[] = prepared.failures;
  const preparedGroups = prepared.preparedGroups;
  failures.forEach((failure) => Logger.log(failure.reason, "error"));

  const preparedOutputText = applyAttachmentDeliveryFailures(resultBatch.outputParts, failures)
    .join("\n\n");
  const shouldAttachText = shouldAttachResultText(preparedOutputText, domSelectors);
  const files = preparedGroups.flatMap((prepared) => prepared.files);
  if (shouldAttachText) {
    files.push(createTextAttachmentFile(preparedOutputText, BRANDING.resultFilePrefix));
  }

  const pasteResult = await dispatchToolAttachments(files, domSelectors);
  appendPasteFailures(preparedGroups, pasteResult, failures);
  if (pasteResult.acknowledged) {
    Logger.log(`Attachment paste acknowledged (${files.length} file(s))`, "success");
  }

  if (failures.length > 0) {
    notifyAttachmentDeliveryFailure(failures[0]?.reason);
  }

  const outputText = applyAttachmentDeliveryFailures(resultBatch.outputParts, failures).join("\n\n");
  const inlineText = getAttachmentInlineText(outputText, shouldAttachText, pasteResult.acknowledged);
  const writeResult = await writeToInputBoxWithVerification(inlineText, domSelectors.inputArea);
  if (!writeResult.delivered) {
    notifyResultDeliveryFailure(true);
  }

  return toDeliveryStatus(pasteResult.dispatched, writeResult, true);
}

function shouldAttachResultText(text: string, domSelectors: SiteSelectors): boolean {
  const maxInlineChars = domSelectors.maxInlineChars ?? 0;
  if (!maxInlineChars) {return false;}
  const inputEl = getInputAreaElement(domSelectors);
  const finalInlineText = inputEl ? buildFinalInputText(inputEl, text) : text;
  return finalInlineText.length > maxInlineChars;
}

async function dispatchToolAttachments(
  files: readonly File[],
  domSelectors: SiteSelectors
): Promise<AttachmentPasteDispatchResult> {
  if (files.length === 0) {
    return {
      acknowledged: false,
      dispatched: false,
      reason: "No attachment file was available for browser delivery.",
    };
  }
  const pasteResult = pasteFilesAsAttachments(files, domSelectors);
  if (pasteResult.dispatched) {
    await delay(TOOL_ATTACHMENT_SETTLE_MS);
  }
  return pasteResult;
}

function appendPasteFailures(
  preparedGroups: readonly { group: ToolResultAttachmentGroup }[],
  pasteResult: AttachmentPasteDispatchResult,
  failures: ToolResultAttachmentFailure[]
): void {
  if (pasteResult.acknowledged) {return;}
  const detail = pasteResult.dispatched
    ? "the target page did not acknowledge the simulated paste event. " +
      "The site may not support file uploads, paste uploads, or this file format."
    : pasteResult.reason ?? "the simulated paste event could not be dispatched.";
  preparedGroups.forEach(({ group }) => {
    const reason = buildAttachmentFailureReason(group, detail);
    failures.push(toAttachmentFailure(group, reason));
    Logger.log(reason, "error");
  });
}

function getAttachmentInlineText(
  outputText: string,
  shouldAttachText: boolean,
  attachmentAcknowledged: boolean
): string {
  if (!shouldAttachText || !attachmentAcknowledged) {return outputText;}
  return i18n.resources.oversize ??
    "The result exceeds the character limit. It has been attached as a text file. Please read the attached file for the full details.";
}

async function writeToInputBoxWithVerification(text: string, inputSelector: string): Promise<InputWriteResult> {
  const inputEl = getInputAreaBySelector(inputSelector);
  if (!inputEl) {
    Logger.log(t("input_not_found"), "error");
    return { delivered: false, attemptedWrite: false };
  }

  const initialText = getInputText(inputEl);
  const final = buildFinalInputTextFromCurrentText(initialText, text);
  let attemptedWrite = false;

  for (let attempt = 0; attempt < INPUT_WRITE_VERIFY_DELAYS_MS.length; attempt++) {
    const latestInputEl = getInputAreaBySelector(inputSelector);
    if (!latestInputEl) {
      Logger.log(t("input_not_found"), "error");
      return { delivered: false, attemptedWrite };
    }

    attemptedWrite = true;
    try {
      setInputBoxText(final, latestInputEl, attempt > 0);
    } catch (error) {
      Logger.log(`Input write attempt failed: ${getErrorMessage(error)}`, "warn");
    }
    await delay(INPUT_WRITE_VERIFY_DELAYS_MS[attempt]);

    const verifiedInputEl = getInputAreaBySelector(inputSelector) ?? latestInputEl;
    if (isInputTextDelivered(verifiedInputEl, final, initialText)) {
      Logger.log(t("result_written"), "action");
      return { delivered: true, attemptedWrite };
    }

    if (attempt < INPUT_WRITE_VERIFY_DELAYS_MS.length - 1) {
      Logger.log(
        `Input write verification failed. Retrying (${attempt + 1}/${INPUT_WRITE_VERIFY_DELAYS_MS.length})`,
        "warn"
      );
    }
  }

  Logger.log("Input write failed after verification retries. Auto-send skipped.", "error");
  return { delivered: false, attemptedWrite };
}

function toDeliveryStatus(
  uploaded: boolean,
  writeResult: InputWriteResult,
  attemptedUpload: boolean
): DeliverResultStatus {
  return {
    uploaded,
    delivered: writeResult.delivered,
    attemptedWrite: writeResult.attemptedWrite,
    attemptedUpload,
  };
}

function notifyResultDeliveryFailure(attemptedUpload: boolean): void {
  void showUserAttentionNotification({
    title: "Result Delivery Failed",
    message: attemptedUpload
      ? "Could not verify the file attachment. Check the input box and attachment manually."
      : "Could not write result to input box. Check the page manually.",
  });
}

function notifyAttachmentDeliveryFailure(reason: string | undefined): void {
  void showUserAttentionNotification({
    title: "Attachment Delivery Failed",
    message: reason ?? "The target page did not accept the file attachment.",
  });
}

function buildFinalInputText(
  inputEl: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
  text: string
): string {
  return buildFinalInputTextFromCurrentText(getInputText(inputEl), text);
}

function buildFinalInputTextFromCurrentText(currentText: string, text: string): string {
  let cur = currentText;
  cur = cur.replace(/\r\n/g, "\n").replace(/\n+/g, "\n").trim();
  const sep = cur ? "\n\n" : "";
  return cur + sep + text;
}

function isInputTextDelivered(
  inputEl: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
  expectedFinalText: string,
  initialText: string
): boolean {
  const current = normalizeInputTextForComparison(getInputText(inputEl));
  const expected = normalizeInputTextForComparison(expectedFinalText);
  if (current === expected) {
    return true;
  }

  if (!current) {
    return false;
  }

  const initial = normalizeInputTextForComparison(initialText);
  if (!initial) {
    return true;
  }

  return getContentFingerprint(current) !== getContentFingerprint(initial);
}

function getInputText(inputEl: HTMLElement | HTMLInputElement | HTMLTextAreaElement): string {
  if (isTextControl(inputEl)) {
    return inputEl.value;
  }
  return inputEl.innerText ?? inputEl.textContent ?? "";
}

function normalizeInputText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

function normalizeInputTextForComparison(text: string): string {
  return normalizeInputText(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function getContentFingerprint(text: string): string {
  return text.replace(/\s+/g, "");
}

function isTextControl(inputEl: HTMLElement): inputEl is HTMLInputElement | HTMLTextAreaElement {
  return inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement;
}

function setTextControlValue(inputEl: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype = inputEl instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  valueDescriptor?.set?.call(inputEl, text);

  if (inputEl.value !== text) {
    inputEl.value = text;
  }
}

/**
 * 模拟 `pasteFile` (粘贴文件) 模式上传文本内容为附件
 * @param text 要作为附件的纯文本内容
 * @param domSelectors 网页对应选择器配置对象 (从 settings/init 下发)
 * @returns 派发 paste 事件返回 `true`，找不到输入框或派发失败返回 `false`
 * @description
 * - 寻找页面上的文本输入区域。
 * - 使用 `DataTransfer` 创造一个虚拟剪贴板，把带有时间戳名字的 TXT 文本文件放入剪贴板内。
 * - 构造并在这个输入区域上主动派发一个 `ClipboardEvent`（即“粘贴”事件）。
 * - 绝大多数先进的 AI 网页平台会立刻读取这个事件并自动把它当作一个图片或者文本文件上传。
 */
export async function pasteTextAsAttachment(
  text: string,
  domSelectors: SiteSelectors,
  filenamePrefix: string = BRANDING.resultFilePrefix
): Promise<boolean> {
  const pasteResult = pasteFilesAsAttachments([
    createTextAttachmentFile(text, filenamePrefix),
  ], domSelectors);
  if (!pasteResult.dispatched) {return false;}

  await delay(LEGACY_ATTACHMENT_SETTLE_MS);
  return true;
}

export function pasteFilesAsAttachments(
  files: readonly File[],
  domSelectors: SiteSelectors
): AttachmentPasteDispatchResult {
  const inputEl = getInputAreaElement(domSelectors);
  if (!inputEl) {
    return {
      acknowledged: false,
      dispatched: false,
      reason: "The target page input area was not found.",
    };
  }
  if (files.length === 0) {
    return {
      acknowledged: false,
      dispatched: false,
      reason: "No files were available for the simulated paste.",
    };
  }

  try {
    const clipboardData = new DataTransfer();
    files.forEach((file) => clipboardData.items.add(file));

    inputEl.focus();
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    const notCanceled = inputEl.dispatchEvent(pasteEvent);
    return {
      acknowledged: isPasteEventAcknowledged(notCanceled, pasteEvent.defaultPrevented),
      dispatched: true,
    };
  } catch (error) {
    const reason = `The simulated paste event failed: ${getErrorMessage(error)}.`;
    Logger.log(`Attachment paste dispatch failed: ${reason}`, "warn");
    return {
      acknowledged: false,
      dispatched: false,
      reason,
    };
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
