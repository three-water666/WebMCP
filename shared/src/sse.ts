export interface ServerSentEvent {
  data: string;
  event: string;
  id?: string;
  retry?: number;
}

interface PendingServerSentEvent {
  dataLines: string[];
  event?: string;
  id?: string;
  retry?: number;
}

const MAX_PENDING_SSE_CHARS = 8_000_000;

export class ServerSentEventDecoder {
  private buffer = "";
  private pending = createPendingEvent();

  public push(chunk: string): ServerSentEvent[] {
    this.buffer += chunk;
    this.assertBufferLimit();

    const events: ServerSentEvent[] = [];
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.consumeLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, events);
      newlineIndex = this.buffer.indexOf("\n");
    }

    return events;
  }

  public finish(): ServerSentEvent[] {
    const events: ServerSentEvent[] = [];
    if (this.buffer.length > 0) {
      const finalLine = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = "";
      this.consumeLine(finalLine, events);
    }
    this.dispatchPending(events);
    return events;
  }

  private consumeLine(line: string, events: ServerSentEvent[]): void {
    if (line === "") {
      this.dispatchPending(events);
      return;
    }
    if (line.startsWith(":")) {
      return;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex < 0 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex < 0 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    this.applyField(field, value);
  }

  private applyField(field: string, value: string): void {
    switch (field) {
      case "data":
        this.pending.dataLines.push(value);
        break;
      case "event":
        this.pending.event = value;
        break;
      case "id":
        if (!value.includes("\0")) {
          this.pending.id = value;
        }
        break;
      case "retry": {
        const retry = Number(value);
        if (Number.isInteger(retry) && retry >= 0) {
          this.pending.retry = retry;
        }
        break;
      }
      default:
        break;
    }
  }

  private dispatchPending(events: ServerSentEvent[]): void {
    if (this.pending.dataLines.length === 0) {
      this.pending = createPendingEvent();
      return;
    }

    events.push({
      data: this.pending.dataLines.join("\n"),
      event: this.pending.event && this.pending.event.length > 0 ? this.pending.event : "message",
      id: this.pending.id,
      retry: this.pending.retry,
    });
    this.pending = createPendingEvent();
  }

  private assertBufferLimit(): void {
    const pendingChars = this.buffer.length + this.pending.dataLines.reduce((total, line) => total + line.length, 0);
    if (pendingChars > MAX_PENDING_SSE_CHARS) {
      throw new Error("SSE event exceeded the capture size limit.");
    }
  }
}

function createPendingEvent(): PendingServerSentEvent {
  return { dataLines: [] };
}
