import type { SiteSelectors } from "../modules/config";
import { CompletionNotifier } from "./completion_notifier";

interface FollowUpPanelControl {
  setEnabled(enabled: boolean): void;
}

export const OBSERVED_PAGE_WORK_ATTRIBUTES = [
  "aria-busy", "aria-disabled", "aria-hidden", "aria-label", "class",
  "data-disabled", "data-loading", "data-state", "data-test-id", "data-testid",
  "data-visible", "disabled", "hidden", "inert", "style", "title",
];

/** Keeps the follow-up launcher enabled and detects ordinary response completion. */
export class FollowUpWorkController {
  private readonly completionNotifier: CompletionNotifier;

  public constructor(
    private readonly panel: FollowUpPanelControl,
    onCompletedWithoutTools: () => void
  ) {
    this.completionNotifier = new CompletionNotifier({ onCompletedWithoutTools });
  }

  public observe(selectors: SiteSelectors): void {
    this.panel.setEnabled(true);
    this.completionNotifier.observe(selectors);
  }

  public reset(): void {
    this.completionNotifier.reset();
    this.panel.setEnabled(false);
  }
}
