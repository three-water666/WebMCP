import type { SiteSelectors } from "../modules/config";
import { isStopButtonVisible } from "../modules/page_selectors";
import { CompletionNotifier } from "./completion_notifier";
import { FollowUpOverlay } from "./follow_up_overlay";
import type { FollowUpQueue } from "./follow_up_queue";
import type { ToolActivityTracker } from "./tool_activity";

export const OBSERVED_PAGE_WORK_ATTRIBUTES = [
  "aria-busy", "aria-disabled", "aria-hidden", "aria-label", "class",
  "data-disabled", "data-loading", "data-state", "data-test-id", "data-testid",
  "data-visible", "disabled", "hidden", "inert", "style", "title",
];

/** Synchronizes the follow-up overlay with ordinary generation and tool activity. */
export class FollowUpWorkController {
  private readonly completionNotifier: CompletionNotifier;
  private readonly overlay: FollowUpOverlay;

  public constructor(
    queue: FollowUpQueue,
    tracker: ToolActivityTracker,
    onCompletedWithoutTools: () => void
  ) {
    this.overlay = new FollowUpOverlay(queue, tracker);
    this.completionNotifier = new CompletionNotifier({ onCompletedWithoutTools });
  }

  public observe(selectors: SiteSelectors): void {
    this.overlay.setEnabled(true);
    this.overlay.setGenerating(isStopButtonVisible(selectors));
    this.completionNotifier.observe(selectors);
  }

  public reset(): void {
    this.completionNotifier.reset();
    this.overlay.setEnabled(false);
    this.overlay.setGenerating(false);
  }
}
