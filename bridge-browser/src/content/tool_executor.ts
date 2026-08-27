import { BRANDING, isBootstrapOnlyToolName, PROTOCOL } from "@webcode/shared";
import type { SiteSelectors } from "../modules/config";
import * as UI from "../modules/ui";
import { i18n, t } from "../modules/i18n";
import { Logger } from "../modules/logger";
import type { ToolExecutionPayload } from "../types";
import { buildWebcodeInitPrompt } from "./init_context";
import {
  buildStoredApprovalEntries,
  getApprovalLabel,
  isPayloadApproved,
  persistApprovalRule,
  type ApprovalState,
} from "./approval_policy";
import { grantCommandApproval, preflightCommand } from "./command_preflight";
import type { ToolActivityStatus } from "./tool_activity";
import { type ToolRequestIdentity, type ToolRequestRegistry } from "./tool_request_registry";

interface ToolExecutorOptions {
  getSelectors: () => SiteSelectors | null;
  getSiteId: () => string | null;
  getWorkspaceId: () => string;
  getApprovalState: () => ApprovalState;
  getAutoApproveTools: () => boolean;
  onActivityStatusChange: (
    identity: ToolRequestIdentity,
    status: ToolActivityStatus,
    message?: string
  ) => void;
  requestRegistry: ToolRequestRegistry;
  scheduleMainLoop: (delayMs: number) => void;
}

interface ToolExecutionResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

interface QueuedApprovalRequest {
  request: ToolExecutionRequest;
  reject: (error: Error) => void;
  resolve: (approved: boolean) => void;
}

interface ToolExecutionRequest {
  identity: ToolRequestIdentity;
  payload: ToolExecutionPayload;
}

export class ToolExecutor {
  private readonly approvalQueue: QueuedApprovalRequest[] = [];
  private readonly pendingApprovals = new Map<string, Promise<boolean>>();
  private readonly toolExecutionQueue: ToolExecutionRequest[] = [];
  private isApprovalQueueRunning = false;
  private isToolExecutionQueueRunning = false;

  public constructor(private readonly options: ToolExecutorOptions) {}

  public execute(payload: ToolExecutionPayload, identity: ToolRequestIdentity): void {
    const request: ToolExecutionRequest = {
      identity,
      payload,
    };

    // Normal capture flow assigns a stable identity in ToolCallTracker before execution.
    this.options.onActivityStatusChange(identity, "queued");
    this.toolExecutionQueue.push(request);
    void this.processToolExecutionQueue();
  }

  private queueApprovalIfNeeded(request: ToolExecutionRequest): Promise<boolean> | null {
    if (!this.needsApproval(request.payload)) {return null;}

    const requestKey = request.identity.requestKey;
    const existingApproval = this.pendingApprovals.get(requestKey);
    if (existingApproval) {return existingApproval;}

    const approval = new Promise<boolean>((resolve, reject) => {
      this.approvalQueue.push({
        request,
        reject: (error) => reject(error),
        resolve,
      });
    });
    this.pendingApprovals.set(requestKey, approval);
    void this.processApprovalQueue();

    return approval;
  }

  private async processApprovalQueue(): Promise<void> {
    if (this.isApprovalQueueRunning) {return;}

    this.isApprovalQueueRunning = true;
    try {
      while (this.approvalQueue.length > 0) {
        const approvalRequest = this.approvalQueue.shift();
        if (!approvalRequest) {continue;}

        try {
          if (!this.needsApproval(approvalRequest.request.payload)) {
            this.pendingApprovals.delete(approvalRequest.request.identity.requestKey);
            this.options.onActivityStatusChange(approvalRequest.request.identity, "queued");
            approvalRequest.resolve(true);
            continue;
          }

          this.options.onActivityStatusChange(approvalRequest.request.identity, "awaiting_approval");
          Logger.log(`${t("hitl_intercept")}: ${approvalRequest.request.payload.name}`, "warn");
          const approved = await this.requestToolApproval(approvalRequest.request);
          approvalRequest.resolve(approved);
        } catch (error) {
          this.pendingApprovals.delete(approvalRequest.request.identity.requestKey);
          approvalRequest.reject(toError(error));
        }
      }
    } finally {
      this.isApprovalQueueRunning = false;
      if (this.approvalQueue.length > 0) {
        void this.processApprovalQueue();
      }
    }
  }

  private async processToolExecutionQueue(): Promise<void> {
    if (this.isToolExecutionQueueRunning) {return;}

    this.isToolExecutionQueueRunning = true;
    try {
      while (this.toolExecutionQueue.length > 0) {
        const request = this.toolExecutionQueue.shift();
        if (!request) {continue;}

        try {
          await this.runQueuedTool(request);
        } catch (error) {
          this.failQueuedTool(request, error);
        }
      }
    } finally {
      this.isToolExecutionQueueRunning = false;
      if (this.toolExecutionQueue.length > 0) {
        void this.processToolExecutionQueue();
      }
    }
  }

  private async runQueuedTool(request: ToolExecutionRequest): Promise<void> {
    if (request.payload.name === PROTOCOL.initToolName) {
      this.options.onActivityStatusChange(request.identity, "executing");
      await this.initializeWebcode(request);
      return;
    }

    if (isBootstrapOnlyToolName(request.payload.name)) {
      this.rejectBootstrapOnlyTool(request);
      return;
    }

    const preflight = await preflightCommand(request.payload);
    let approvalToken: string | undefined;
    if (preflight?.risk?.level === "blocked") {
      throw new Error(`Command blocked by security policy: ${preflight.risk.reasons.join(" ")}`);
    }
    if (preflight?.risk?.level === "requires_confirmation") {
      this.options.onActivityStatusChange(request.identity, "awaiting_approval");
      const approved = await this.requestToolApproval(request, {
        mandatory: true,
        riskReasons: preflight.risk.reasons,
      });
      if (!approved) {return;}
      if (!preflight.challengeId) {
        throw new Error("Gateway did not return a command approval challenge.");
      }
      approvalToken = await grantCommandApproval(preflight.challengeId);
    } else {
      const approved = await this.waitForApproval(request);
      if (!approved) {return;}
    }

    this.options.onActivityStatusChange(request.identity, "executing");
    await this.performExecution(request, approvalToken);
  }

  private async waitForApproval(request: ToolExecutionRequest): Promise<boolean> {
    const requestKey = request.identity.requestKey;
    if (!this.needsApproval(request.payload)) {
      this.pendingApprovals.delete(requestKey);
      return true;
    }

    const approval = this.pendingApprovals.get(requestKey) ?? this.queueApprovalIfNeeded(request);
    if (!approval) {return true;}

    try {
      return await approval;
    } finally {
      this.pendingApprovals.delete(requestKey);
    }
  }

  private needsApproval(payload: ToolExecutionPayload): boolean {
    if (payload.name === PROTOCOL.initToolName || isBootstrapOnlyToolName(payload.name)) {return false;}
    if (this.options.getAutoApproveTools()) {return false;}
    return !isPayloadApproved(payload, this.options.getApprovalState());
  }

  private failQueuedTool(request: ToolExecutionRequest, error: unknown): void {
    const message = getErrorMessage(error) || "Tool execution failed.";
    this.options.requestRegistry.markSettled(request.identity.requestKey);
    this.options.onActivityStatusChange(request.identity, "failed", message);
    Logger.log(`${t("exec_fail")}: ${message}`, "error");
    this.options.requestRegistry.saveToolResult(
      request.identity.requestKey,
      request.identity.requestId,
      message,
      true,
      request.payload.name
    );
    this.options.scheduleMainLoop(50);
  }

  /**
   * 执行客户端侧的初始化虚拟工具，并在结果准备好后调度主循环回填。
   *
   * 初始化工具不会走远端普通工具的完整回调链，它会在这里聚合项目规则、工具列表和技能列表，
   * 然后直接写入 request registry。由于 registry 状态变化本身不会触发页面 DOM 变化，必须在
   * 状态写完后调用 scheduleMainLoop，让主循环发现该 requestKey 已完成并把初始化内容写回输入框。
   */
  private async initializeWebcode(request: ToolExecutionRequest): Promise<void> {
    const finalPrompt = await buildWebcodeInitPrompt({
      siteId: this.options.getSiteId(),
    });

    this.options.requestRegistry.saveRawResult(request.identity.requestKey, finalPrompt);
    this.options.requestRegistry.markSettled(request.identity.requestKey);
    this.options.onActivityStatusChange(request.identity, "succeeded");
    // 给当前调用栈一点时间收尾，再让主循环批处理回填，和普通工具完成路径保持一致。
    this.options.scheduleMainLoop(50);
  }

  /**
   * 发送真实工具调用到扩展后台，并在后台响应后调度主循环回填。
   *
   * 后台工具执行完成时，content script 只会收到这个回调；页面 DOM 不会因为 registry 更新
   * 自动变化。这里先把 requestKey 标记为已结束，再把成功或失败结果写入 registry，
   * 最后通过 scheduleMainLoop 通知主循环重新计算当前轮次是否已经全部完成。
   */
  private performExecution(
    request: ToolExecutionRequest,
    approvalToken?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: "EXECUTE_TOOL", payload: request.payload, approvalToken },
          (response: unknown) => {
            this.options.requestRegistry.markSettled(request.identity.requestKey);

            if (chrome.runtime.lastError) {
              const errorMessage = chrome.runtime.lastError.message ?? "Tool execution failed.";
              this.options.onActivityStatusChange(request.identity, "failed", errorMessage);
              Logger.log(`${t("exec_fail")}: ${errorMessage}`, "error");
              this.options.requestRegistry.saveToolResult(
                request.identity.requestKey,
                request.identity.requestId,
                errorMessage,
                true,
                request.payload.name
              );
              this.options.scheduleMainLoop(50);
              resolve();
              return;
            }

            const result = normalizeToolResponse(response);
            if (result.success) {
              this.options.onActivityStatusChange(request.identity, "succeeded");
              Logger.log(`${t("exec_success")}: ${request.payload.name}`, "success");
              const outputContent = formatSuccessfulResult(request.payload.name, result.data);
              this.options.requestRegistry.saveToolResult(
                request.identity.requestKey,
                request.identity.requestId,
                outputContent,
                false,
                request.payload.name
              );
            } else {
              this.options.onActivityStatusChange(
                request.identity,
                "failed",
                result.error ?? "Tool execution failed."
              );
              Logger.log(`${t("exec_fail")}: ${result.error}`, "error");
              this.options.requestRegistry.saveToolResult(
                request.identity.requestKey,
                request.identity.requestId,
                result.error ?? "Tool execution failed.",
                true,
                request.payload.name
              );
            }

            // 工具完成不会触发 MutationObserver，需要主动安排一次扫描来推动批量回填。
            this.options.scheduleMainLoop(50);
            resolve();
          }
        );
      } catch (error) {
        reject(toError(error));
      }
    });
  }

  private rejectBootstrapOnlyTool(request: ToolExecutionRequest): void {
    const message = i18n.lang === "zh"
      ? [
        `工具 ${request.payload.name} 仅供 ${BRANDING.productName} 初始化使用，不能由模型直接调用。`,
        "请根据已初始化的工具和技能列表继续。",
      ].join("")
      : [
        `Tool ${request.payload.name} is reserved for ${BRANDING.productName} initialization and cannot be called directly by the model.`,
        " Continue with the initialized tool and skill lists.",
      ].join("");

    this.options.requestRegistry.markSettled(request.identity.requestKey);
    this.options.onActivityStatusChange(request.identity, "failed", message);
    Logger.log(`${t("exec_fail")}: ${message}`, "error");
    this.options.requestRegistry.saveToolResult(
      request.identity.requestKey,
      request.identity.requestId,
      message,
      true,
      request.payload.name
    );
    this.options.scheduleMainLoop(50);
  }

  private requestToolApproval(
    request: ToolExecutionRequest,
    modalOptions: UI.ApprovalModalOptions = {}
  ): Promise<boolean> {
    return new Promise((resolve) => {
      UI.showConfirmationModal(
        request.payload,
        (scope) => {
          this.focusInput();

          if (scope && !modalOptions.mandatory) {
            persistApprovalRule(request.payload, scope, this.options.getApprovalState());
            void chrome.storage.local.set({
              [`allowed_tools_${this.options.getWorkspaceId()}`]: buildStoredApprovalEntries(this.options.getApprovalState()),
            });
            Logger.log(`⚡ Approval saved for '${getApprovalLabel(request.payload, scope)}' in this workspace`, "action");
          }

          resolve(true);
        },
        (reason) => {
          this.options.requestRegistry.markSettled(request.identity.requestKey);
          this.options.onActivityStatusChange(
            request.identity,
            "rejected",
            reason || "No reason provided."
          );
          this.focusInput();
          Logger.log(`${t("hitl_rejected")}: ${request.payload.name}`, "error");
          this.options.requestRegistry.saveToolResult(
            request.identity.requestKey,
            request.identity.requestId,
            `User rejected execution. Reason: ${reason || "No reason provided."}`,
            true,
            request.payload.name
          );
          this.options.scheduleMainLoop(50);
          resolve(false);
        },
        modalOptions
      );
    });
  }

  private focusInput(): void {
    const selectors = this.options.getSelectors();
    if (!selectors) {return;}

    UI.focusInputArea(selectors);
  }
}

function formatSuccessfulResult(toolName: string, data: unknown): string {
  return formatToolOutput(data, getToolResultFallback(toolName));
}

function formatToolOutput(data: unknown, fallback: string): string {
  return stringifyToolData(data, fallback);
}

function getToolResultFallback(_toolName: string): string {
  return "";
}

function normalizeToolResponse(response: unknown): ToolExecutionResponse {
  if (!isRecord(response)) {
    return {
      success: false,
      error: "Tool execution failed.",
    };
  }

  return {
    success: response.success === true,
    error: typeof response.error === "string" ? response.error : undefined,
    data: response.data,
  };
}

function stringifyToolData(data: unknown, fallback: string): string {
  if (typeof data === "string") {return data;}
  if (data == null) {return fallback;}
  const json = JSON.stringify(data, null, 2);
  if (typeof json === "string") {return json;}
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return String(data);
  }
  return fallback;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
