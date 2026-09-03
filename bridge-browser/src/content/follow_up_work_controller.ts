import type { SiteSelectors } from "../modules/config";
import { CompletionNotifier } from "./completion_notifier";
import { FollowUpOverlay } from "./follow_up_overlay";
import type { FollowUpQueue } from "./follow_up_queue";

export const OBSERVED_PAGE_WORK_ATTRIBUTES = [
  "aria-busy", "aria-disabled", "aria-hidden", "aria-label", "class",
  "data-disabled", "data-loading", "data-state", "data-test-id", "data-testid",
  "data-visible", "disabled", "hidden", "inert", "style", "title",
];

/** Keeps the follow-up launcher enabled and detects ordinary response completion. */
export class FollowUpWorkController {
  private readonly completionNotifier: CompletionNotifier;
  private readonly overlay: FollowUpOverlay;

  public constructor(
    queue: FollowUpQueue,
    onCompletedWithoutTools: () => void
  ) {
    this.overlay = new FollowUpOverlay(queue);
    this.completionNotifier = new CompletionNotifier({ onCompletedWithoutTools });
  }

  public observe(selectors: SiteSelectors): void {
    this.overlay.setEnabled(true);
    this.completionNotifier.observe(selectors);
  }

  public reset(): void {
    this.completionNotifier.reset();
    this.overlay.setEnabled(false);
  }
}
