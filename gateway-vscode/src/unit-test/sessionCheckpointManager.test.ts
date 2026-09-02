import assert from 'assert';
import { SessionCheckpointManager } from '../session/sessionCheckpointManager';
import { SessionCheckpointService } from '../session/sessionCheckpoint';
import { SessionCheckpointStateStore } from '../session/sessionCheckpointState';

const persistence = {
    save: () => Promise.resolve('# Session Checkpoint')
};

suite('SessionCheckpointManager', () => {


    test('does not create checkpoint when not required', async () => {
        const state = new SessionCheckpointStateStore();
        const manager = new SessionCheckpointManager(
            new SessionCheckpointService(),
            persistence,
            state
        );

        const result = await manager.createIfNeeded(
            {
                status: 'healthy',
                score: 100,
                risks: [],
                shouldCheckpoint: false
            },
            '/workspace'
        );

        assert.strictEqual(result, null);
    });

    test('creates checkpoint when required', async () => {
        const state = new SessionCheckpointStateStore();
        const manager = new SessionCheckpointManager(
            new SessionCheckpointService(),
            persistence,
            state
        );

        const result = await manager.createIfNeeded(
            {
                status: 'warning',
                score: 70,
                risks: ['context growth'],
                shouldCheckpoint: true
            },
            '/workspace'
        );

        assert.ok(result);
        assert.ok(result.includes('# Session Checkpoint'));
    });
});
