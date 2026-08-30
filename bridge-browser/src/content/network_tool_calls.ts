import { t } from "../modules/i18n";
import { Logger } from "../modules/logger";
import type { NetworkCaptureCompletedEvent } from "../modules/network_capture_protocol";
import { looksLikeToolCall, parseToolCall } from "../modules/toolCallProtocol";
import * as UI from "../modules/ui";
import { logToolSummary, type ToolCallTracker } from "./tool_call_tracker";
import type { ToolActivityTracker } from "./tool_activity";
import type { ToolExecutor } from "./tool_executor";
import type { BufferedResultBatch, ToolRequestRegistry } from "./tool_request_registry";

interface NetworkToolCallControllerOptions {
  canDeliver: () => boolean;
  deliver: (batch: BufferedResultBatch) => void;
  requestRegistry: ToolRequestRegistry;
  scheduleMainLoop: (delayMs: number) => void;
  toolActivityTracker: ToolActivityTracker;
  toolCallTracker: ToolCallTracker;
  toolExecutor: ToolExecutor;
}

interface PendingNetworkTurn {
  captureId: string;
  generation: number;
  requestKeys: string[];
}

export class NetworkToolCallController {
  private generation = 0;
  private readonly pendingTurns: PendingNetworkTurn[] = [];
  private lastProgressStatus = "";
  private lastProgressTime = 0;

  public constructor(private readonly options: NetworkToolCallControllerOptions) {}

  public ingest(event: NetworkCaptureCompletedEvent): boolean {
    const candidates = collectTurnCandidates(event);
    if (candidates.length === 0) {
      return false;
    }

    const generation = this.generation;
    this.options.toolActivityTracker.beginTurn(event.captureId);
    const requestKeys: string[] = [];
    candidates.forEach((candidate) => {
      const identity = this.captureCandidate(
        candidate.text,
        candidate.turnId,
        event.captureId,
        candidate.index,
        generation
      );
      requestKeys.push(identity.requestKey);
    });
    this.pendingTurns.push({ captureId: event.captureId, generation, requestKeys });
    this.options.scheduleMainLoop(0);
    return true;
  }

  public flushReadyTurn(): void {
    while (this.pendingTurns.length > 0) {
      const pendingTurn = this.pendingTurns[0];
      if (pendingTurn.generation !== this.generation) {
        this.pendingTurns.shift();
        continue;
      }
      const pendingBatch = this.options.requestRegistry.getUnflushedBatch(pendingTurn.requestKeys);
      if (!pendingBatch.hasRequests) {
        this.pendingTurns.shift();
        continue;
      }
      if (!pendingBatch.isComplete) {
        this.logProgress(pendingBatch.completedCount, pendingBatch.totalCount);
        return;
      }
      if (!this.options.canDeliver()) {
        this.options.toolActivityTracker.updateDelivery(pendingBatch.ids, "waiting");
        this.options.scheduleMainLoop(1000);
        return;
      }

      const resultBatch = this.options.requestRegistry.buildBufferedResultBatch(pendingBatch.ids);
      if (resultBatch.hasOutput || resultBatch.attachmentGroups.length > 0) {
        Logger.log(`Network batch finished: ${resultBatch.outputCount} tools. Writing...`, "success");
        this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "delivering");
        this.options.deliver(resultBatch);
        return;
      }
      if (resultBatch.hasAnyResult) {
        this.options.requestRegistry.markFlushed(resultBatch.ids);
        this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "delivered");
      }
      this.pendingTurns.shift();
    }
    this.lastProgressStatus = "";
  }

  public hasPendingTurns(): boolean {
    return this.pendingTurns.length > 0;
  }

  public reset(): void {
    this.generation++;
    this.pendingTurns.length = 0;
    this.lastProgressStatus = "";
    this.lastProgressTime = 0;
  }

  private captureCandidate(
    text: string,
    turnId: string,
    activityTurnId: string,
    codeBlockIndex: number,
    generation: number
  ) {
    const scopedTurnId = `${generation}:${turnId}`;
    try {
      const payload = parseToolCall(text);
      const identity = this.options.toolCallTracker.ensureNetworkPayloadRequestIdentity(
        payload,
        scopedTurnId,
        codeBlockIndex
      );
      this.options.toolCallTracker.clearProtocolErrorFeedbackState(identity.requestKey);
      this.options.toolActivityTracker.capture({
        identity,
        payload,
        turnId: activityTurnId,
      });
      if (!this.options.requestRegistry.hasSeen(identity.requestKey)) {
        this.options.requestRegistry.markRunning(identity.requestKey);
        UI.cancelAutoSend();
        Logger.log(`${t("captured")}: ${payload.name} (network)`, "info");
        logToolSummary(payload);
        this.options.toolExecutor.execute(payload, identity);
      }
      return identity;
    } catch (error) {
      const identity = this.options.toolCallTracker.handleNetworkProtocolError(
        text,
        scopedTurnId,
        codeBlockIndex,
        error
      );
      this.options.toolActivityTracker.captureProtocolError({
        identity,
        message: getErrorMessage(error),
        turnId: activityTurnId,
      });
      return identity;
    }
  }

  private logProgress(completedCount: number, totalCount: number): void {
    const status = `${completedCount}/${totalCount}`;
    const now = Date.now();
    if (status === this.lastProgressStatus && now - this.lastProgressTime <= 3000) {
      return;
    }
    Logger.log(`${t("waiting_tools")} (${status}, network)`, "warn");
    this.lastProgressStatus = status;
    this.lastProgressTime = now;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TurnCandidate {
  index: number;
  text: string;
  turnId: string;
}

function collectTurnCandidates(event: NetworkCaptureCompletedEvent): TurnCandidate[] {
  return event.calls
    .filter((call) => looksLikeToolCall(call.text))
    .map((call) => ({
      index: call.index,
      text: call.text,
      turnId: `${event.conversationId ?? event.captureId}:${call.messageId}`,
    }));
}
