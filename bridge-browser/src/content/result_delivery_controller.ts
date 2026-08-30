import type { SiteSelectors } from "../modules/config";
import { Logger } from "../modules/logger";
import * as UI from "../modules/ui";
import type { ToolActivityTracker } from "./tool_activity";
import type { BufferedResultBatch, ToolRequestRegistry } from "./tool_request_registry";

interface ResultDeliveryControllerOptions {
  getAutoSend: () => boolean;
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
    let batchFinalized = false;
    void UI.deliverResult(resultBatch, selectors)
      .then((delivery) => {
        batchFinalized = true;
        this.finalizeBatch(resultBatch.ids);
        if (!delivery.delivered) {
          this.handleDeliveryFailure(resultBatch);
          return;
        }

        this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "delivered");
        UI.triggerAutoSend({ autoSend: this.options.getAutoSend() }, selectors);
      })
      .catch((error: unknown) => {
        batchFinalized = true;
        this.finalizeBatch(resultBatch.ids);
        this.options.toolActivityTracker.updateDelivery(resultBatch.ids, "failed");
        Logger.log(`Result delivery failed: ${getErrorMessage(error)}`, "error");
      })
      .finally(() => this.finishDelivery(batchFinalized));
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

  private finishDelivery(batchFinalized: boolean): void {
    this.isDeliveryRunning = false;
    const shouldRerun = batchFinalized && (
      this.isRerunNeeded || this.options.hasPendingTurns()
    );
    this.isRerunNeeded = false;
    if (shouldRerun) {
      this.options.scheduleMainLoop(50);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
