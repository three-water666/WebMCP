import type { SessionHealthMetrics } from './sessionHealth';
import type { SessionMetrics } from './sessionMetricsCollector';

export interface SessionSemanticMetrics {
  completedTasks: number;
  unresolvedIssues: number;
  summaryConfidence: number;
}

export class SessionHealthAdapter {
  toHealthMetrics(
    metrics: SessionMetrics,
    semanticMetrics: Partial<SessionSemanticMetrics> = {}
  ): SessionHealthMetrics {
    return {
      toolCallCount: metrics.toolCallCount,
      repeatedFileReads: metrics.repeatedFileReads,
      repeatedSearches: metrics.repeatedSearches,
      completedTasks: Math.max(0, semanticMetrics.completedTasks ?? 0),
      unresolvedIssues: Math.max(0, semanticMetrics.unresolvedIssues ?? 0),
      summaryConfidence: this.clampSummaryConfidence(semanticMetrics.summaryConfidence ?? 1)
    };
  }

  private clampSummaryConfidence(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
