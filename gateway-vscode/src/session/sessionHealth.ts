export type HealthStatus =
  | "healthy"
  | "warning"
  | "degraded";

export interface SessionHealthMetrics {
  toolCallCount: number;
  repeatedFileReads: number;
  repeatedSearches: number;
  completedTasks: number;
  unresolvedIssues: number;
  summaryConfidence: number;
}

export interface SessionHealthReport {
  status: HealthStatus;
  score: number;
  risks: string[];
  shouldCheckpoint: boolean;
}

export class SessionHealthAnalyzer {
  analyze(metrics: SessionHealthMetrics): SessionHealthReport {
    let score = 100;
    const risks: string[] = [];

    if (metrics.toolCallCount > 50) {
      score -= 15;
      risks.push("工具调用次数较高");
    }

    if (metrics.repeatedFileReads > 5) {
      score -= 15;
      risks.push("重复读取相同文件");
    }

    if (metrics.repeatedSearches > 5) {
      score -= 15;
      risks.push("重复搜索已经处理的问题");
    }

    if (metrics.unresolvedIssues > 5) {
      score -= 15;
      risks.push("未解决问题数量较多");
    }

    if (metrics.summaryConfidence < 0.5) {
      score -= 20;
      risks.push("无法准确总结当前状态");
    }

    if (metrics.completedTasks > 0 && metrics.unresolvedIssues === 0) {
      risks.push("已有独立任务完成，可考虑生成 checkpoint");
    }

    score = Math.max(0, Math.min(100, score));

    const status: HealthStatus =
      score >= 80
        ? "healthy"
        : score >= 50
          ? "warning"
          : "degraded";

    return {
      status,
      score,
      risks,
      shouldCheckpoint:
        status !== "healthy" || metrics.completedTasks > 0
    };
  }
}
