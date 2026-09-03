import type { SiteSelectors } from "../modules/config";
import { t } from "../modules/i18n";
import { Logger } from "../modules/logger";
import type { ToolResultDeliveryBatch } from "../modules/tool_result";
import * as UI from "../modules/ui";
import type { FollowUpDelivery, FollowUpQueue } from "./follow_up_queue";
import type { ToolActivityTracker } from "./tool_activity";
import type { BufferedResultBatch, ToolRequestRegistry } from "./tool_request_registry";

interface ResultDeliveryControllerOptions {
  getAutoSend: () => boolean;
  followUpQueue: FollowUpQueue;
  hasPendingTurns: () => boolean;
  onBatchFinalized?: (requestKeys: readonly string[]) => void;
  requestRegistry: ToolRequestRegistry;
  scheduleMainLoop: (delayMs: number) => void;
  toolActivityTracker: ToolActivityTracker;
}

export class ResultDeliveryController {
  private isDeliveryRunning = false;
  private isRerunNeeded = false;

  public constructor(private readonly options: ResultDeliveryControllerOptions) {}

  public deliver(resultBatch: BufferedResultBatch, selectors: SiteSelectors): void {
    if (this.isDeliveryRunning) {
      this.isRerunNeeded = true;
      return;
    }

    this.isDeliveryRunning = true;
    this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "delivering");
    void this.deliverResultBatch(resultBatch, selectors);
  }

  /** Sends confirmed follow-ups after an ordinary assistant response with no tool calls. */
  public deliverFollowUps(selectors: SiteSelectors): void {
    if (this.isDeliveryRunning || !this.options.getAutoSend()) {return;}

    const followUps = this.options.followUpQueue.beginDelivery();
    if (followUps.ids.length === 0) {return;}

    this.isDeliveryRunning = true;
    void this.writeFollowUpsAndSend(followUps, selectors)
      .catch((error: unknown) => {
        this.options.followUpQueue.releaseDelivery(followUps.ids);
        Logger.log(`Follow-up delivery failed: ${getErrorMessage(error)}`, "error");
      })
      .finally(() => this.finishDelivery(false));
  }

  private finalizeBatch(requestKeys: readonly string[]): void {
    this.options.requestRegistry.markFlushed(requestKeys);
    this.options.onBatchFinalized?.(requestKeys);
  }

  private handleDeliveryFailure(resultBatch: BufferedResultBatch): void {
    this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "failed");
    Logger.log(
      "Result delivery could not be verified. Marked batch flushed to avoid duplicate delivery; auto-send skipped.",
      "error"
    );
  }

  private async deliverResultBatch(
    resultBatch: BufferedResultBatch,
    selectors: SiteSelectors
  ): Promise<void> {
    let batchFinalized = false;
    try {
      const delivery = await UI.deliverResult(resultBatch, selectors);
      batchFinalized = true;
      this.finalizeBatch(resultBatch.ids);
      if (!delivery.delivered) {
        this.handleDeliveryFailure(resultBatch);
        return;
      }

      this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "delivered");
      const followUps = this.options.getAutoSend()
        ? this.options.followUpQueue.beginDelivery()
        : { ids: [], messages: [] };
      await this.writeFollowUpsAndSend(followUps, selectors, delivery.uploaded);
    } catch (error: unknown) {
      if (!batchFinalized) {
        batchFinalized = true;
        this.finalizeBatch(resultBatch.ids);
        this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "failed");
      }
      Logger.log(`Result delivery failed: ${getErrorMessage(error)}`, "error");
    } finally {
      this.finishDelivery(batchFinalized);
    }
  }

  private async writeFollowUpsAndSend(
    followUps: FollowUpDelivery,
    selectors: SiteSelectors,
    hasFileUpload = false
  ): Promise<void> {
    try {
      if (followUps.ids.length > 0) {
        const delivery = await UI.deliverResult(createFollowUpBatch(followUps.messages), selectors);
        if (!delivery.delivered) {
          this.options.followUpQueue.releaseDelivery(followUps.ids);
          Logger.log("Confirmed follow-ups could not be written. Auto-send skipped.", "error");
          return;
        }
      }

      const sendResult = await UI.triggerAutoSend(
        { autoSend: this.options.getAutoSend(), hasFileUpload },
        selectors
      );
      if (sendResult === "sent") {
        this.options.followUpQueue.completeDelivery(followUps.ids);
      } else {
        this.options.followUpQueue.releaseDelivery(followUps.ids);
      }
    } catch (error) {
      this.options.followUpQueue.releaseDelivery(followUps.ids);
      throw error;
    }
  }

  private finishDelivery(batchFinalized: boolean): void {
    this.isDeliveryRunning = false;
    const shouldRerun = this.isRerunNeeded || (
      batchFinalized && this.options.hasPendingTurns()
    );
    this.isRerunNeeded = false;
    if (shouldRerun) {
      this.options.scheduleMainLoop(50);
    }
  }
}

function createFollowUpBatch(messages: readonly string[]): ToolResultDeliveryBatch {
  const heading = t("follow_up_delivery_heading");
  const outputParts = messages.map((message, index) => {
    const suffix = messages.length > 1 ? ` ${index + 1}` : "";
    return `[${heading}${suffix}]\n${message}`;
  });
  return {
    attachmentGroups: [],
    output: outputParts.join("\n\n"),
    outputParts,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
