import { BRANDING, type ToolProtocolFormat } from "@webcode/shared";
import { i18n } from "../modules/i18n";
import { Logger } from "../modules/logger";
import * as UI from "../modules/ui";
import { ToolCallProtocolError, type ParsedToolCallPayload } from "../modules/toolCallProtocol";
import { buildProtocolErrorHint } from "../modules/toolProtocolFormatting";
import { showUserAttentionNotification } from "../modules/user_attention";
import type { ToolExecutionPayload } from "../types";
import { type ToolRequestIdentity, type ToolRequestRegistry } from "./tool_request_registry";

interface BlockState {
  text: string;
  time: number;
  errorNotified: boolean;
}

interface ToolCallTrackerOptions {
  getToolProtocol: () => ToolProtocolFormat;
  requestRegistry: ToolRequestRegistry;
  scheduleMainLoop: (delayMs: number) => void;
}

const STABILIZATION_TIMEOUT_MS = 3000;

export class ToolCallTracker {
  private readonly blockStates = new WeakMap<Element, BlockState>();
  private readonly protocolErrorFeedbackRequests = new Set<string>();

  public constructor(private readonly options: ToolCallTrackerOptions) {}

  public ensurePayloadRequestIdentity(
    payload: ParsedToolCallPayload,
    codeEl: HTMLElement,
    messageIndex: number,
    codeBlockIndex: number
  ): ToolRequestIdentity {
    const explicitRequestId = normalizeRequestId(payload.request_id);
    if (explicitRequestId) {
      codeEl.dataset.mcpRequestId = explicitRequestId;
      delete codeEl.dataset.mcpCallSignature;
      delete codeEl.dataset.mcpCallScope;
      payload.request_id = explicitRequestId;
      return {
        requestId: explicitRequestId,
        requestKey: ensureElementRequestKey(codeEl, explicitRequestId, messageIndex, codeBlockIndex),
      };
    }

    const signature = buildToolCallSignature(payload);
    const scope = getRequestScope(messageIndex, codeBlockIndex);
    const cachedRequestId = codeEl.dataset.mcpRequestId;
    const cachedSignature = codeEl.dataset.mcpCallSignature;
    const cachedScope = codeEl.dataset.mcpCallScope;
    const syntheticRequestId = cachedRequestId?.startsWith("req_auto_") &&
      cachedSignature === signature &&
      cachedScope === scope
      ? cachedRequestId
      : `req_auto_${messageIndex}_${codeBlockIndex}_${hashStableString(signature)}`;

    codeEl.dataset.mcpRequestId = syntheticRequestId;
    codeEl.dataset.mcpCallSignature = signature;
    codeEl.dataset.mcpCallScope = scope;
    payload.request_id = syntheticRequestId;
    return {
      requestId: syntheticRequestId,
      requestKey: ensureElementRequestKey(codeEl, syntheticRequestId, messageIndex, codeBlockIndex),
    };
  }

  public clearProtocolErrorFeedbackState(requestKey: string): void {
    if (!this.protocolErrorFeedbackRequests.delete(requestKey)) {return;}
    this.options.requestRegistry.clearProtocolFeedbackResult(requestKey);
  }

  public handleProtocolErrorBlock(
    codeEl: HTMLElement,
    textContent: string,
    messageIndex: number,
    codeBlockIndex: number,
    error: unknown
  ): ToolRequestIdentity {
    const now = Date.now();
    const state = this.blockStates.get(codeEl);
    const identity = getProtocolErrorIdentity(textContent, codeEl, messageIndex, codeBlockIndex);

    if (state?.text !== textContent) {
      this.blockStates.set(codeEl, {
        text: textContent,
        time: now,
        errorNotified: false,
      });
      if (codeEl.dataset.mcpState === "error") {
        UI.clearVisualState(codeEl);
      }
      this.scheduleStabilizationCheck();
      return identity;
    }

    if (!state.errorNotified && now - state.time <= STABILIZATION_TIMEOUT_MS) {
      this.scheduleStabilizationCheck();
      return identity;
    }

    if (!state.errorNotified) {
      this.notifyProtocolError(codeEl, identity, error);
      state.errorNotified = true;
      this.blockStates.set(codeEl, state);
    }

    return identity;
  }

  private notifyProtocolError(codeEl: HTMLElement, identity: ToolRequestIdentity, error: unknown): void {
    const message = buildProtocolErrorMessage(error, this.options.getToolProtocol());
    Logger.log(`Tool call protocol error: ${message}`, "error");
    UI.markVisualError(codeEl);
    void showUserAttentionNotification({
      title: `${BRANDING.productName} Error`,
      message: "Invalid tool call format. Returned guidance to the model.",
    });

    if (
      !this.options.requestRegistry.hasSeen(identity.requestKey) &&
      !this.protocolErrorFeedbackRequests.has(identity.requestKey)
    ) {
      this.protocolErrorFeedbackRequests.add(identity.requestKey);
      this.options.requestRegistry.saveToolResult(identity.requestKey, identity.requestId, message, true);
    }
  }

  /**
   * 为解析失败的代码块安排一次稳定性复查。
   *
   * AI 流式输出 JSON 时，代码块经常会短暂处于不完整状态；如果立刻回填协议错误，会把仍在生成
   * 的工具调用误判为失败。handleProtocolErrorBlock 会立即返回稳定身份，让批处理知道该块
   * 仍在等待；这里通过主循环调度入口延迟到稳定窗口之后再扫描一次，届时文本如果没再变化，
   * handleProtocolErrorBlock 才会真正写入协议错误反馈。
   */
  private scheduleStabilizationCheck(): void {
    this.options.scheduleMainLoop(STABILIZATION_TIMEOUT_MS + 50);
  }
}

export function logToolSummary(payload: ToolExecutionPayload): void {
  const purpose = typeof payload.purpose === "string" && payload.purpose.trim()
    ? payload.purpose.trim().replace(/\s+/g, " ")
    : (i18n.lang === "zh" ? "未提供 purpose" : "No purpose provided");
  Logger.log(`${payload.name} | purpose: ${purpose}`, "summary");
}

function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== "string") {return null;}
  const trimmed = value.trim();
  return trimmed || null;
}

function buildToolCallSignature(payload: ToolExecutionPayload): string {
  const payloadArguments: unknown = payload.arguments;
  return stableStringify({
    name: payload.name,
    arguments: payloadArguments ?? {},
  });
}

function stableStringify(value: unknown): string {
  if (value === null) {return "null";}

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    return stableStringifyObject(value as Record<string, unknown>);
  }

  return stableStringifyPrimitive(value);
}

function stableStringifyObject(record: Record<string, unknown>): string {
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function stableStringifyPrimitive(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value) ?? "";
  }
  if (typeof value === "bigint") {return `${value.toString()}n`;}
  if (typeof value === "symbol") {return value.description ? `symbol:${value.description}` : "symbol";}
  if (typeof value === "function") {return `function:${value.name}`;}
  return "undefined";
}

function hashStableString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ensureElementRequestKey(
  codeEl: HTMLElement,
  requestId: string,
  messageIndex: number,
  codeBlockIndex: number
): string {
  const seed = stableStringify({
    codeBlockIndex,
    messageIndex,
    request_id: requestId,
  });
  const cachedRequestKey = codeEl.dataset.mcpRequestKey;
  const cachedRequestKeySeed = codeEl.dataset.mcpRequestKeySeed;
  if (cachedRequestKey && cachedRequestKeySeed === seed) {
    return cachedRequestKey;
  }

  const requestKey = `req_key_${messageIndex}_${codeBlockIndex}_${hashStableString(seed)}`;
  codeEl.dataset.mcpRequestKey = requestKey;
  codeEl.dataset.mcpRequestKeySeed = seed;
  return requestKey;
}

function getProtocolErrorIdentity(
  textContent: string,
  codeEl: HTMLElement,
  messageIndex: number,
  codeBlockIndex: number
): ToolRequestIdentity {
  const explicitRequestId = extractRequestIdCandidate(textContent);
  if (explicitRequestId) {
    codeEl.dataset.mcpRequestId = explicitRequestId;
    return {
      requestId: explicitRequestId,
      requestKey: ensureElementRequestKey(codeEl, explicitRequestId, messageIndex, codeBlockIndex),
    };
  }

  const cachedRequestId = codeEl.dataset.mcpRequestId;
  const textSignature = hashStableString(textContent);
  const scope = getRequestScope(messageIndex, codeBlockIndex);
  if (
    cachedRequestId?.startsWith("req_invalid_") &&
    codeEl.dataset.mcpInvalidSignature === textSignature &&
    codeEl.dataset.mcpInvalidScope === scope
  ) {
    return {
      requestId: cachedRequestId,
      requestKey: ensureElementRequestKey(codeEl, cachedRequestId, messageIndex, codeBlockIndex),
    };
  }

  const syntheticRequestId = `req_invalid_${messageIndex}_${codeBlockIndex}_${textSignature}`;
  codeEl.dataset.mcpRequestId = syntheticRequestId;
  codeEl.dataset.mcpInvalidSignature = textSignature;
  codeEl.dataset.mcpInvalidScope = scope;
  return {
    requestId: syntheticRequestId,
    requestKey: ensureElementRequestKey(codeEl, syntheticRequestId, messageIndex, codeBlockIndex),
  };
}

function extractRequestIdCandidate(textContent: string): string | null {
  const jsonMatch = /["']request_id["']\s*:\s*["']([^"']+)["']/.exec(textContent);
  if (jsonMatch) {return normalizeRequestId(jsonMatch[1]);}
  const xmlElementMatch = /<request_id(?:\s[^>]*)?>([\s\S]*?)<\/request_id\s*>/i.exec(textContent);
  if (xmlElementMatch) {return normalizeRequestId(xmlElementMatch[1]);}
  const xmlAttributeMatch = /\brequest_id\s*=\s*(["'])(.*?)\1/i.exec(textContent);
  return normalizeRequestId(xmlAttributeMatch?.[2]);
}

function getRequestScope(messageIndex: number, codeBlockIndex: number): string {
  return `${messageIndex}:${codeBlockIndex}`;
}

function buildProtocolErrorMessage(error: unknown, toolProtocol: ToolProtocolFormat): string {
  const issues = error instanceof ToolCallProtocolError
    ? error.issues
    : [error instanceof Error ? error.message : String(error)];
  const intro = i18n.lang === "zh"
    ? "工具调用已被 webcode 拒绝，未请求 VS Code，也未执行任何工具。"
    : "The tool call was rejected by webcode before contacting VS Code. No tool was executed.";
  const formatName = toolProtocol === "xml" ? "XML" : "JSON";
  const nextStep = i18n.lang === "zh"
    ? `请按当前 ${formatName} 协议重新输出一个新的工具调用代码块。name 和 purpose 必填，request_id 必须为本会话新值，arguments 必须严格匹配工具的 inputSchema。`
    : `Regenerate one tool-call code block using the active ${formatName} protocol. name and purpose are required, request_id must be new, and arguments must match the tool inputSchema.`;
  const issueList = issues.map((issue) => `- ${issue}`).join("\n");
  const formatHint = buildProtocolErrorHint(toolProtocol, i18n.lang);
  return `${intro}\n\nProblems:\n${issueList}\n\n${nextStep}\n\n${formatHint}`;
}
