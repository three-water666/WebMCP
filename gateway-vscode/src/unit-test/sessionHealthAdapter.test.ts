import * as assert from 'assert';

import { SessionHealthAnalyzer } from '../session/sessionHealth';
import { SessionHealthAdapter } from '../session/sessionHealthAdapter';
import { SessionMetricsCollector, type SessionMetrics } from '../session/sessionMetricsCollector';

suite('Session Health Adapter', () => {
  test('converts SessionMetrics with default semantic metrics', () => {
    const adapter = new SessionHealthAdapter();
    const metrics: SessionMetrics = {
      toolCallCount: 10,
      fileReadCount: 8,
      repeatedFileReads: 2,
      searchCount: 5,
      repeatedSearches: 1,
      modifiedFileCount: 3
    };

    assert.deepStrictEqual(adapter.toHealthMetrics(metrics), {
      toolCallCount: 10,
      repeatedFileReads: 2,
      repeatedSearches: 1,
      completedTasks: 0,
      unresolvedIssues: 0,
      summaryConfidence: 1
    });
  });

  test('overrides default semantic metrics', () => {
    const adapter = new SessionHealthAdapter();
    const metrics = createMetrics();

    assert.deepStrictEqual(adapter.toHealthMetrics(metrics, {
      completedTasks: 2,
      unresolvedIssues: 1,
      summaryConfidence: 0.8
    }), {
      toolCallCount: 10,
      repeatedFileReads: 2,
      repeatedSearches: 1,
      completedTasks: 2,
      unresolvedIssues: 1,
      summaryConfidence: 0.8
    });
  });

  test('clamps summaryConfidence to the 0 to 1 range', () => {
    const adapter = new SessionHealthAdapter();
    const metrics = createMetrics();

    assert.strictEqual(
      adapter.toHealthMetrics(metrics, { summaryConfidence: -1 }).summaryConfidence,
      0
    );
    assert.strictEqual(
      adapter.toHealthMetrics(metrics, { summaryConfidence: 2 }).summaryConfidence,
      1
    );
  });

  test('clamps negative task metrics to zero', () => {
    const adapter = new SessionHealthAdapter();
    const metrics = createMetrics();
    const result = adapter.toHealthMetrics(metrics, {
      completedTasks: -1,
      unresolvedIssues: -2
    });

    assert.strictEqual(result.completedTasks, 0);
    assert.strictEqual(result.unresolvedIssues, 0);
  });

  test('supports Collector to Adapter to Analyzer flow', () => {
    const collector = new SessionMetricsCollector();
    const adapter = new SessionHealthAdapter();
    const analyzer = new SessionHealthAnalyzer();

    collector.recordToolCall('read_file');
    collector.recordFileRead('a.ts');
    collector.recordFileRead('a.ts');
    collector.recordSearch('SessionHealth');
    collector.recordSearch('SessionHealth');

    const metrics = collector.getMetrics();
    const healthMetrics = adapter.toHealthMetrics(metrics);
    const report = analyzer.analyze(healthMetrics);

    assert.strictEqual(healthMetrics.toolCallCount, 1);
    assert.strictEqual(healthMetrics.repeatedFileReads, 1);
    assert.strictEqual(healthMetrics.repeatedSearches, 1);
    assert.strictEqual(report.status, 'healthy');
    assert.strictEqual(report.score, 100);
  });
});

function createMetrics(): SessionMetrics {
  return {
    toolCallCount: 10,
    fileReadCount: 8,
    repeatedFileReads: 2,
    searchCount: 5,
    repeatedSearches: 1,
    modifiedFileCount: 3
  };
}
