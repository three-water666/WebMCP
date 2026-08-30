import { PROTOCOL } from "@webcode/shared";
import type { SiteSelectors } from "../modules/config";
import { i18n } from "../modules/i18n";

interface AutoInitTrigger {
  replacementStart: number;
  end: number;
}

export type AutoInitPromptMode = "replace-trigger" | "append-forgotten" | "append-manual";

const AUTO_INIT_TRIGGER_TOKEN_RE = /(?:\/webcode|@webcode)(?=$|[\s\n.,，。!?！？:：;；])/gi;
const AUTO_INIT_INVALID_PREFIX_RE = /[A-Za-z0-9_/@.]/;
const AUTO_INIT_IGNORABLE_PREFIX_RE = /[\s\u00a0\uFEFF\u200B]/;

export function findAutoInitTrigger(text: string): AutoInitTrigger | null {
  AUTO_INIT_TRIGGER_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = AUTO_INIT_TRIGGER_TOKEN_RE.exec(text)) !== null) {
    const tokenStart = match.index;
    const previousChar = tokenStart > 0 ? text[tokenStart - 1] : "";

    if (AUTO_INIT_INVALID_PREFIX_RE.test(previousChar)) {
      continue;
    }

    let replacementStart = tokenStart;
    while (replacementStart > 0 && AUTO_INIT_IGNORABLE_PREFIX_RE.test(text[replacementStart - 1])) {
      replacementStart--;
    }

    return {
      replacementStart,
      end: tokenStart + match[0].length,
    };
  }

  return null;
}

export function buildReplacementForContext(
  mode: AutoInitPromptMode,
  latestText: string,
  initPrompt: string
): string | null {
  if (mode === "replace-trigger") {
    const latestTrigger = findAutoInitTrigger(latestText);
    if (!latestTrigger) {return null;}
    return buildInitReplacement(latestText, latestTrigger, initPrompt);
  }

  if (mode === "append-forgotten" && !latestText.trim()) {return null;}
  return buildAppendInitReplacement(latestText, initPrompt);
}

export function buildOversizedInitPromptNotice(): string {
  if (i18n.lang === "zh") {
    return [
      "完整初始化上下文超过当前输入框字符限制，webcode 已将其作为 txt 附件添加到本条消息。",
      "请读取附件内容作为本次会话的 webcode 初始化上下文，并根据上面的用户任务继续。",
    ].join("\n");
  }

  return [
    "The full initialization context exceeds this input box character limit, so webcode attached it as a txt file to this message.",
    "Read the attachment as the webcode initialization context for this session, then continue with the user task above.",
  ].join("\n");
}

export function getMaxInlineChars(selectors: SiteSelectors): number {
  return typeof selectors.maxInlineChars === "number" && selectors.maxInlineChars > 0
    ? selectors.maxInlineChars
    : 0;
}

export function hasInitializationContextMarker(text: string): boolean {
  const normalizedText = normalizePromptMarkerText(text);
  if (!normalizedText) {return false;}

  if (normalizedText.includes(PROTOCOL.initToolName.toLowerCase())) {
    return true;
  }

  if (
    hasResourcePromptMarker(normalizedText, i18n.resources.prompt) ||
    hasResourcePromptMarker(normalizedText, i18n.resources.init)
  ) {
    return true;
  }

  return hasOversizedInitPromptNoticeMarker(normalizedText) ||
    hasProtocolPromptScaffoldMarker(normalizedText);
}

function buildInitReplacement(text: string, trigger: AutoInitTrigger, initPrompt: string): string {
  const beforeTrigger = text.slice(0, trigger.replacementStart);
  const afterTrigger = text.slice(trigger.end);
  const prefix = beforeTrigger.trim() ? "\n\n" : "";
  return `${beforeTrigger}${prefix}${initPrompt.trim()}\n\n${afterTrigger}`;
}

function buildAppendInitReplacement(text: string, initPrompt: string): string {
  const beforeInitPrompt = text.trimEnd();
  const prefix = beforeInitPrompt.trim() ? "\n\n" : "";
  return `${beforeInitPrompt}${prefix}${initPrompt.trim()}`;
}

function hasResourcePromptMarker(normalizedText: string, resource: string | null): boolean {
  const marker = getResourcePromptMarker(resource);
  return Boolean(marker && normalizedText.includes(marker));
}

function getResourcePromptMarker(resource: string | null): string | null {
  if (!resource) {return null;}

  const normalizedResource = normalizePromptMarkerText(resource);
  if (!normalizedResource) {return null;}

  return normalizedResource.slice(0, Math.min(400, normalizedResource.length));
}

function hasOversizedInitPromptNoticeMarker(normalizedText: string): boolean {
  return normalizedText.includes("完整初始化上下文超过当前输入框字符限制") ||
    normalizedText.includes("full initialization context exceeds this input box character limit");
}

function hasProtocolPromptScaffoldMarker(normalizedText: string): boolean {
  return normalizedText.includes("mcp_action") &&
    normalizedText.includes("purpose") &&
    normalizedText.includes("available tools");
}

function normalizePromptMarkerText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}
