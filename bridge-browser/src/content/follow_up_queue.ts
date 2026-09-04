export type FollowUpItemStatus = "confirmed" | "sending";

export interface FollowUpItem {
  id: string;
  status: FollowUpItemStatus;
  text: string;
}

export interface FollowUpDelivery {
  ids: string[];
  messages: string[];
}

export interface FollowUpQueueSnapshot {
  items: FollowUpItem[];
}

type FollowUpQueueListener = (snapshot: FollowUpQueueSnapshot) => void;

/** Keeps explicitly confirmed user follow-ups separate from unfinished input. */
export class FollowUpQueue {
  private idSequence = 0;
  private readonly items: FollowUpItem[] = [];
  private readonly listeners = new Set<FollowUpQueueListener>();

  public confirm(text: string): FollowUpItem | null {
    const normalized = text.trim();
    if (!normalized) {return null;}

    const item: FollowUpItem = {
      id: `follow-up-${Date.now()}-${++this.idSequence}`,
      status: "confirmed",
      text: normalized,
    };
    this.items.push(item);
    this.emit();
    return { ...item };
  }

  public remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id && item.status === "confirmed");
    if (index < 0) {return false;}

    this.items.splice(index, 1);
    this.emit();
    return true;
  }

  public beginDelivery(): FollowUpDelivery {
    const deliverable = this.items.filter((item) => item.status === "confirmed");
    if (deliverable.length === 0) {
      return { ids: [], messages: [] };
    }

    deliverable.forEach((item) => {item.status = "sending";});
    this.emit();
    return {
      ids: deliverable.map((item) => item.id),
      messages: deliverable.map((item) => item.text),
    };
  }

  public completeDelivery(ids: readonly string[]): void {
    const deliveredIds = new Set(ids);
    const remaining = this.items.filter((item) => !deliveredIds.has(item.id));
    if (remaining.length === this.items.length) {return;}

    this.items.splice(0, this.items.length, ...remaining);
    this.emit();
  }

  public releaseDelivery(ids: readonly string[]): void {
    const releasedIds = new Set(ids);
    let changed = false;
    this.items.forEach((item) => {
      if (releasedIds.has(item.id) && item.status === "sending") {
        item.status = "confirmed";
        changed = true;
      }
    });
    if (changed) {this.emit();}
  }

  public subscribe(listener: FollowUpQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private getSnapshot(): FollowUpQueueSnapshot {
    return { items: this.items.map((item) => ({ ...item })) };
  }
}
