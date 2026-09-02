export interface SessionMetrics {
  toolCallCount: number;

  fileReadCount: number;

  repeatedFileReads: number;

  searchCount: number;

  repeatedSearches: number;

  modifiedFileCount: number;
}

export class SessionMetricsCollector {
  private toolCallCount = 0;

  private readonly fileReadHistory = new Map<string, number>();

  private readonly searchHistory = new Map<string, number>();

  private readonly modifiedFiles = new Set<string>();

  recordToolCall(_toolName: string): void {
    this.toolCallCount += 1;
  }

  recordFileRead(filePath: string): void {
    const count = (this.fileReadHistory.get(filePath) ?? 0) + 1;
    this.fileReadHistory.set(filePath, count);
  }

  recordSearch(query: string): void {
    const count = (this.searchHistory.get(query) ?? 0) + 1;
    this.searchHistory.set(query, count);
  }

  recordFileModification(filePath: string): void {
    this.modifiedFiles.add(filePath);
  }

  getMetrics(): SessionMetrics {
    return {
      toolCallCount: this.toolCallCount,
      fileReadCount: this.getTotalCount(this.fileReadHistory),
      repeatedFileReads: this.getRepeatedCount(this.fileReadHistory),
      searchCount: this.getTotalCount(this.searchHistory),
      repeatedSearches: this.getRepeatedCount(this.searchHistory),
      modifiedFileCount: this.modifiedFiles.size
    };
  }

  reset(): void {
    this.toolCallCount = 0;
    this.fileReadHistory.clear();
    this.searchHistory.clear();
    this.modifiedFiles.clear();
  }

  private getTotalCount(records: Map<string, number>): number {
    return Array.from(records.values()).reduce((sum, count) => sum + count, 0);
  }

  private getRepeatedCount(records: Map<string, number>): number {
    return Array.from(records.values())
      .reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  }
}
