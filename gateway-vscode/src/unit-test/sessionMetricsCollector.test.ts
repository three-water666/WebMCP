import assert from 'assert';
import { SessionMetricsCollector } from '../session/sessionMetricsCollector';

suite('SessionMetricsCollector', () => {
  test('initial metrics should be zero', () => {
    const collector = new SessionMetricsCollector();

    assert.deepStrictEqual(collector.getMetrics(), {
      toolCallCount: 0,
      fileReadCount: 0,
      repeatedFileReads: 0,
      searchCount: 0,
      repeatedSearches: 0,
      modifiedFileCount: 0
    });
  });

  test('records tool calls', () => {
    const collector = new SessionMetricsCollector();

    collector.recordToolCall('read_file');

    assert.strictEqual(collector.getMetrics().toolCallCount, 1);
  });

  test('counts repeated file reads', () => {
    const collector = new SessionMetricsCollector();

    collector.recordFileRead('a.ts');
    collector.recordFileRead('a.ts');

    const metrics = collector.getMetrics();

    assert.strictEqual(metrics.fileReadCount, 2);
    assert.strictEqual(metrics.repeatedFileReads, 1);
  });

  test('counts repeated searches', () => {
    const collector = new SessionMetricsCollector();

    collector.recordSearch('SessionHealth');
    collector.recordSearch('SessionHealth');

    const metrics = collector.getMetrics();

    assert.strictEqual(metrics.searchCount, 2);
    assert.strictEqual(metrics.repeatedSearches, 1);
  });

  test('counts modified files uniquely', () => {
    const collector = new SessionMetricsCollector();

    collector.recordFileModification('a.ts');
    collector.recordFileModification('a.ts');

    assert.strictEqual(collector.getMetrics().modifiedFileCount, 1);
  });

  test('reset clears metrics', () => {
    const collector = new SessionMetricsCollector();

    collector.recordToolCall('read_file');
    collector.recordFileRead('a.ts');
    collector.recordSearch('abc');
    collector.recordFileModification('a.ts');

    collector.reset();

    assert.deepStrictEqual(collector.getMetrics(), {
      toolCallCount: 0,
      fileReadCount: 0,
      repeatedFileReads: 0,
      searchCount: 0,
      repeatedSearches: 0,
      modifiedFileCount: 0
    });
  });
});
