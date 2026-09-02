import { SessionHealthAnalyzer } from './sessionHealth';
import { SessionHealthAdapter } from './sessionHealthAdapter';
import { SessionCheckpointManager } from './sessionCheckpointManager';
import { SessionCheckpointService } from './sessionCheckpoint';
import { SessionCheckpointPersistence } from './sessionCheckpointPersistence';
import { SessionCheckpointStateStore } from './sessionCheckpointState';
import { SessionMetricsCollector } from './sessionMetricsCollector';

export class SessionRuntime {
    readonly metricsCollector: SessionMetricsCollector;

    readonly healthAdapter: SessionHealthAdapter;

    readonly healthAnalyzer: SessionHealthAnalyzer;

    readonly checkpointService: SessionCheckpointService;

    readonly checkpointPersistence: SessionCheckpointPersistence;

    readonly checkpointState: SessionCheckpointStateStore;

    readonly checkpointManager: SessionCheckpointManager;

    constructor() {
        this.metricsCollector = new SessionMetricsCollector();
        this.healthAdapter = new SessionHealthAdapter();
        this.healthAnalyzer = new SessionHealthAnalyzer();
        this.checkpointService = new SessionCheckpointService();
        this.checkpointPersistence = new SessionCheckpointPersistence();
        this.checkpointState = new SessionCheckpointStateStore();
        this.checkpointManager = new SessionCheckpointManager(
            this.checkpointService,
            this.checkpointPersistence,
            this.checkpointState
        );
    }

    getHealth() {
        const metrics = this.healthAdapter.toHealthMetrics(
            this.metricsCollector.getMetrics()
        );

        return this.healthAnalyzer.analyze(metrics);
    }

    createCheckpoint(data: Parameters<SessionCheckpointService['generateContent']>[0]): string {
        return this.checkpointService.generateContent(data);
    }

    reset(): void {
        this.metricsCollector.reset();
    }
}
