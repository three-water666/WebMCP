import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GatewayRuntimeTraceEvent {
    event: string;
    requestId?: string;
    toolName?: string;
    status?: 'started' | 'success' | 'error';
    durationMs?: number;
    details?: Record<string, unknown>;
}

export type GatewayRuntimeTraceSink = (event: GatewayRuntimeTraceEvent) => void;

export function createGatewayRuntimeTraceSinkFromEnvironment(): GatewayRuntimeTraceSink | undefined {
    if (process.env.WEBCODE_EVAL_MODE !== '1') {
        return undefined;
    }

    const tracePath = process.env.WEBCODE_EVAL_TRACE_PATH?.trim();
    if (!tracePath) {
        return undefined;
    }

    const runDirectory = process.env.WEBCODE_EVAL_RUN_DIR?.trim();
    const runId = runDirectory ? path.basename(runDirectory) : 'unknown-eval-run';

    return event => {
        const record = {
            timestamp: new Date().toISOString(),
            runId,
            source: 'gateway',
            ...event,
        };
        fs.appendFileSync(tracePath, `${JSON.stringify(record)}\n`, 'utf8');
    };
}
