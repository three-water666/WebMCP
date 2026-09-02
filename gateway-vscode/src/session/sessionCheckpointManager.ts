import type { SessionHealthReport } from './sessionHealth';
import { SessionCheckpointPolicy } from './sessionCheckpointPolicy';
import type { SessionCheckpointService } from './sessionCheckpoint';
import type { SessionCheckpointPersistence } from './sessionCheckpointPersistence';
import type { SessionCheckpointStateStore } from './sessionCheckpointState';

export class SessionCheckpointManager {
    private readonly policy = new SessionCheckpointPolicy();

    constructor(
        private readonly checkpointService: SessionCheckpointService,
        private readonly checkpointPersistence: SessionCheckpointPersistence,
        private readonly checkpointState: SessionCheckpointStateStore
    ) {}

    async createIfNeeded(
        health: SessionHealthReport,
        workspaceRoot: string
    ): Promise<string | null> {
        if (!this.policy.shouldCreate(health)) {
            return null;
        }

        const content = this.checkpointService.generateContent(
            this.checkpointState.getState()
        );

        return this.checkpointPersistence.save(
            workspaceRoot,
            content
        );
    }
}
