import type {
  ToolRequestRegistry,
  ToolRequestTurn,
  UnflushedRequestBatch,
} from "./tool_request_registry";

export interface DomToolTurnLocation {
  conversationKey: string;
  messageIndex: number;
}

interface ActiveDomToolTurn {
  conversationKey: string;
  messageElement: Element;
  messageIndex: number;
  requests: ToolRequestTurn;
}

/**
 * Keeps the active DOM tool turn stable while one assistant message grows across streaming scans.
 *
 * A turn becomes trusted only when it is first observed outside virtualized history. Once trusted,
 * the same message can keep adding calls even if response growth leaves the viewport far behind the
 * live bottom. Unrelated history messages never replace a pending active turn.
 */
export class DomToolTurnController {
  private activeTurn: ActiveDomToolTurn | null = null;

  public constructor(private readonly requestRegistry: ToolRequestRegistry) {}

  /**
   * Observe the latest rendered assistant message and report whether it belongs to the active turn.
   */
  public observeMessage(
    messageElement: Element,
    location: DomToolTurnLocation,
    viewingVirtualizedHistory: boolean
  ): boolean {
    if (this.activeTurn?.conversationKey !== location.conversationKey) {
      this.activeTurn = null;
    }

    const matchingTurn = this.getActiveTurn(messageElement, location, viewingVirtualizedHistory);
    if (matchingTurn) {
      matchingTurn.messageElement = messageElement;
      return true;
    }

    if (this.activeTurn?.requests.getUnflushedBatch().hasRequests) {
      return false;
    }

    if (viewingVirtualizedHistory) {
      return false;
    }

    this.activeTurn = {
      conversationKey: location.conversationKey,
      messageElement,
      messageIndex: location.messageIndex,
      requests: this.requestRegistry.createTurn(),
    };
    return true;
  }

  /**
   * Record the current identity for a code-block slot in the active message.
   */
  public recordRequest(codeBlockIndex: number, requestKey: string): void {
    this.activeTurn?.requests.set(codeBlockIndex, requestKey);
  }

  public getUnflushedBatch(): UnflushedRequestBatch {
    return this.activeTurn?.requests.getUnflushedBatch() ?? createEmptyBatch();
  }

  /**
   * Release a turn after its delivered request keys have been marked flushed in the registry.
   */
  public finalizeRequests(requestKeys: readonly string[]): void {
    if (!this.activeTurn?.requests.hasAny(requestKeys)) {return;}
    if (this.activeTurn.requests.getUnflushedBatch().hasRequests) {return;}
    this.activeTurn = null;
  }

  public reset(): void {
    this.activeTurn = null;
  }

  private getActiveTurn(
    messageElement: Element,
    location: DomToolTurnLocation,
    viewingVirtualizedHistory: boolean
  ): ActiveDomToolTurn | null {
    const activeTurn = this.activeTurn;
    if (activeTurn?.conversationKey !== location.conversationKey) {
      return null;
    }

    if (activeTurn.messageIndex !== location.messageIndex) {
      return null;
    }

    if (!viewingVirtualizedHistory || activeTurn.messageElement === messageElement) {
      return activeTurn;
    }

    return !activeTurn.messageElement.isConnected ? activeTurn : null;
  }
}

function createEmptyBatch(): UnflushedRequestBatch {
  return {
    completedCount: 0,
    hasRequests: false,
    ids: [],
    isComplete: false,
    totalCount: 0,
  };
}
