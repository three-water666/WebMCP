import type { ToolExecutionPayload } from "../types";
import type { ToolActivityTracker } from "./tool_activity";
import type { ToolRequestIdentity } from "./tool_request_registry";

interface CaptureDomActivityOptions {
  identity: ToolRequestIdentity;
  messageElement: Element;
  payload: ToolExecutionPayload;
}

/**
 * Groups DOM-captured tool calls by their assistant message before registering them with
 * the shared activity tracker. The message element gives each rendered turn a stable
 * identity across repeated MutationObserver scans without relying on list indexes.
 */
export class DomToolActivityController {
  private turnSequence = 0;
  private turnIds = new WeakMap<Element, string>();

  public constructor(private readonly tracker: ToolActivityTracker) {}

  public capture(options: CaptureDomActivityOptions): void {
    this.tracker.capture({
      identity: options.identity,
      payload: options.payload,
      source: "dom",
      turnId: this.getTurnId(options.messageElement),
    });
  }

  public reset(): void {
    this.turnIds = new WeakMap<Element, string>();
  }

  private getTurnId(messageElement: Element): string {
    const existingTurnId = this.turnIds.get(messageElement);
    if (existingTurnId) {return existingTurnId;}

    const turnId = `dom:${++this.turnSequence}`;
    this.turnIds.set(messageElement, turnId);
    return turnId;
  }
}
