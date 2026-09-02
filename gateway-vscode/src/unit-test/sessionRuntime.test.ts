import assert from 'assert';
import { SessionRuntime } from '../session/sessionRuntime';

suite('SessionRuntime', () => {
    test('keeps one metrics collector instance and resets state', () => {
        const runtime = new SessionRuntime();

        runtime.metricsCollector.recordToolCall('read_file');

        assert.strictEqual(runtime.metricsCollector.getMetrics().toolCallCount, 1);

        runtime.reset();

        assert.strictEqual(runtime.metricsCollector.getMetrics().toolCallCount, 0);
    });

    test('creates checkpoint content through service', () => {
        const runtime = new SessionRuntime();

        const content = runtime.createCheckpoint({
            currentGoal: 'test checkpoint',
            completedWork: ['health metrics'],
            changedFiles: ['sessionRuntime.ts'],
            verification: 'pnpm test passed',
            nextStep: 'continue'
        });

        assert.ok(content.includes('# Session Checkpoint'));
        assert.ok(content.includes('test checkpoint'));
        assert.ok(content.includes('sessionRuntime.ts'));
    });
});
