import type { SessionMetrics } from './sessionMetricsCollector';

export type SessionHealthLevel =
    | 'healthy'
    | 'compress_recommended'
    | 'restart_recommended';

export interface SessionHealthStatus {
    level: SessionHealthLevel;
    score: number;
    reasons: string[];
    suggestion: string;
}

export class SessionHealthAnalyzer {
    analyze(metrics: SessionMetrics): SessionHealthStatus {
        let score = 0;
        const reasons: string[] = [];

        if (metrics.toolCallCount >= 100) {
            score += 30;
            reasons.push('工具调用次数较高');
        }

        if (metrics.repeatedFileReads >= 10) {
            score += 20;
            reasons.push('存在较多重复文件读取');
        }

        if (metrics.repeatedSearches >= 5) {
            score += 20;
            reasons.push('存在较多重复搜索');
        }

        if (metrics.modifiedFileCount >= 20) {
            score += 15;
            reasons.push('修改文件数量较多');
        }

        if (score >= 70) {
            return {
                level: 'restart_recommended',
                score,
                reasons,
                suggestion: '建议生成上下文摘要并启动新会话'
            };
        }

        if (score >= 35) {
            return {
                level: 'compress_recommended',
                score,
                reasons,
                suggestion: '建议创建会话 checkpoint 或压缩上下文'
            };
        }

        return {
            level: 'healthy',
            score,
            reasons,
            suggestion: '当前会话状态正常，可继续工作'
        };
    }
}
