import { BRANDING, PROTOCOL } from "@webcode/shared";
import { i18n } from "../modules/i18n";
import { Logger } from "../modules/logger";
import * as UI from "../modules/ui";
import { ToolCallProtocolError, type ParsedToolCallPayload } from "../modules/toolCallProtocol";
import { showUserAttentionNotification } from "../modules/user_attention";
import type { ToolExecutionPayload } from "../types";
import { type ToolRequestIdentity, type ToolRequestRegistry } from "./tool_request_registry";

interface BlockState {
  text: string;
  time: number;
  errorNotified: boolean;
}

interface ToolCallTrackerOptions {
  requestRegistry: ToolRequestRegistry;
  scheduleMainLoop: (delayMs: number) => void;
}

export interface DomToolCallLocation {
  conversationKey: string;
  messageIndex: number;
}

const STABILIZATION_TIMEOUT_MS = 3000;

export class ToolCallTracker {
  private readonly blockStates = new WeakMap<Element, BlockState>();
  private readonly protocolErrorFeedbackRequests = new Set<string>();

  public constructor(private readonly options: ToolCallTrackerOptions) {}

  public ensurePayloadRequestIdentity(
    payload: ParsedToolCallPayload,
    codeEl: HTMLElement,
    messageLocation: DomToolCallLocation,
    codeBlockIndex: number
  ): ToolRequestIdentity {
    const signature = buildToolCallSignature(payload);
    const scope = buildDomRequestScope(messageLocation, codeBlockIndex);
    return {
      requestKey: ensureElementRequestKey(codeEl, scope, signature),
    };
  }

  public ensureNetworkPayloadRequestIdentity(
    payload: ParsedToolCallPayload,
    turnId: string,
    codeBlockIndex: number
  ): ToolRequestIdentity {
    const signature = buildToolCallSignature(payload);
    return {
      requestKey: buildNetworkRequestKey(turnId, codeBlockIndex, signature),
    };
  }

  public clearProtocolErrorFeedbackState(requestKey: string): void {
    if (!this.protocolErrorFeedbackRequests.delete(requestKey)) {return;}
    this.options.requestRegistry.clearProtocolFeedbackResult(requestKey);
  }

  public handleProtocolErrorBlock(
    codeEl: HTMLElement,
    textContent: string,
    messageLocation: DomToolCallLocation,
    codeBlockIndex: number,
    error: unknown
  ): ToolRequestIdentity {
    const now = Date.now();
    const state = this.blockStates.get(codeEl);
    const scope = buildDomRequestScope(messageLocation, codeBlockIndex);
    const identity = getProtocolErrorIdentity(textContent, codeEl, scope);

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

  public handleNetworkProtocolError(
    textContent: string,
    turnId: string,
    codeBlockIndex: number,
    error: unknown
  ): ToolRequestIdentity {
    const identity = {
      requestKey: buildNetworkRequestKey(turnId, codeBlockIndex, `invalid:${textContent}`),
    };
    const message = buildProtocolErrorMessage(error);
    Logger.log(`Tool call protocol error: ${message}`, "error");
    void showUserAttentionNotification({
      title: `${BRANDING.productName} Error`,
      message: "Invalid tool call format. Returned guidance to the model.",
    });

    if (
      !this.options.requestRegistry.hasSeen(identity.requestKey) &&
      !this.protocolErrorFeedbackRequests.has(identity.requestKey)
    ) {
      this.protocolErrorFeedbackRequests.add(identity.requestKey);
      this.options.requestRegistry.saveToolResult(identity.requestKey, message, {
        isError: true,
        toolName: "invalid_tool_call",
      });
    }
    return identity;
  }

  private notifyProtocolError(codeEl: HTMLElement, identity: ToolRequestIdentity, error: unknown): void {
    const message = buildProtocolErrorMessage(error);
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
      this.options.requestRegistry.saveToolResult(identity.requestKey, message, {
        isError: true,
        toolName: "invalid_tool_call",
      });
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

function buildDomRequestScope(
  messageLocation: DomToolCallLocation,
  codeBlockIndex: number
): string {
  const conversationHash = hashStableString(messageLocation.conversationKey);
  return `dom_${conversationHash}_${messageLocation.messageIndex}:${codeBlockIndex}`;
}

function ensureElementRequestKey(
  codeEl: HTMLElement,
  scope: string,
  signature: string
): string {
  const seed = stableStringify({
    scope,
    signature,
  });
  const cachedRequestKey = codeEl.dataset.mcpRequestKey;
  const cachedRequestKeySeed = codeEl.dataset.mcpRequestKeySeed;
  if (cachedRequestKey && cachedRequestKeySeed === seed) {
    return cachedRequestKey;
  }

  const requestKey = `call_${scope}_${hashStableString(seed)}`;
  codeEl.dataset.mcpRequestKey = requestKey;
  codeEl.dataset.mcpRequestKeySeed = seed;
  return requestKey;
}

function buildNetworkRequestKey(turnId: string, codeBlockIndex: number, signature: string): string {
  const seed = stableStringify({
    codeBlockIndex,
    signature,
    turnId,
  });
  return `call_network_${hashStableString(seed)}`;
}

function getProtocolErrorIdentity(
  textContent: string,
  codeEl: HTMLElement,
  scope: string
): ToolRequestIdentity {
  const textSignature = hashStableString(textContent);
  return {
    requestKey: ensureElementRequestKey(codeEl, scope, `invalid:${textSignature}`),
  };
}

function buildProtocolErrorMessage(error: unknown): string {
  const issues = error instanceof ToolCallProtocolError
    ? error.issues
    : [error instanceof Error ? error.message : String(error)];
  const intro = i18n.lang === "zh"
    ? "工具调用已被 webcode 拒绝，未请求 VS Code，也未执行任何工具。"
    : "The tool call was rejected by webcode before contacting VS Code. No tool was executed.";
  const nextStep = i18n.lang === "zh"
    ? "请重新输出一个新的 JSON 工具调用代码块。顶层只能包含 mcp_action、name、purpose、arguments；name 和 purpose 必填。当前工具有入参时，arguments 必须严格匹配该工具的 inputSchema。"
    : "Regenerate a new JSON tool-call code block. Top-level fields may only be mcp_action, name, purpose, and arguments; name and purpose are required. When the selected tool has inputs, arguments must exactly match that tool's inputSchema.";
  const issueList = issues.map((issue) => `- ${issue}`).join("\n");
  const formatHint = getDefaultProtocolErrorHint();
  return `${intro}\n\nProblems:\n${issueList}\n\n${nextStep}\n\n${formatHint}`;
}

function getDefaultProtocolErrorHint(): string {
  return `Standard tool format:
\`\`\`json
{
  "mcp_action": "call",
  "name": "tool_name",
  "purpose": "Brief justification for this action",
  "arguments": {
    "key": "value"
  }
}
\`\`\`

Initialization tool format:
\`\`\`json
{
  "mcp_action": "call",
  "name": "${PROTOCOL.initToolName}",
  "purpose": "Initialize webcode for this conversation"
}
\`\`\``;
}
