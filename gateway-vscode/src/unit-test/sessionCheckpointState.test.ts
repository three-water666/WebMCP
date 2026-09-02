import assert from 'assert';
import { SessionCheckpointStateStore } from '../session/sessionCheckpointState';

suite('SessionCheckpointStateStore', () => {
    test('starts with empty state', () => {
        const store = new SessionCheckpointStateStore();

        assert.deepStrictEqual(store.getState(), {
            currentGoal: '',
            completedWork: [],
            changedFiles: [],
            verification: '',
            nextStep: ''
        });
    });

    test('updates checkpoint progress state', () => {
        const store = new SessionCheckpointStateStore();

        store.updateGoal('implement checkpoint');
        store.recordCompletedWork('state store');
        store.recordChangedFile('sessionCheckpointState.ts');
        store.recordChangedFile('sessionCheckpointState.ts');

        assert.deepStrictEqual(store.getState(), {
            currentGoal: 'implement checkpoint',
            completedWork: ['state store'],
            changedFiles: ['sessionCheckpointState.ts'],
            verification: '',
            nextStep: ''
        });
    });

    test('reset clears state', () => {
        const store = new SessionCheckpointStateStore();

        store.updateGoal('temporary');
        store.reset();

        assert.deepStrictEqual(store.getState(), {
            currentGoal: '',
            completedWork: [],
            changedFiles: [],
            verification: '',
            nextStep: ''
        });
    });
});
