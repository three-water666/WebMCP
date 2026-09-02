import type { SessionHealthReport } from './sessionHealth';

export class SessionCheckpointPolicy {
    shouldCreate(health: SessionHealthReport): boolean {
        return health.shouldCheckpoint;
    }
}
