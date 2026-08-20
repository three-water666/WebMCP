import * as fs from 'node:fs';

export interface EvalTraceEvent {
    timestamp: string;
    runId: string;
    source: 'runner' | 'fixture-site' | 'browser' | 'gateway';
    event: string;
    requestId?: string;
    toolName?: string;
    status?: 'started' | 'success' | 'error';
    durationMs?: number;
    details?: Record<string, unknown>;
}

export function appendEvalTrace(
    tracePath: string,
    event: Omit<EvalTraceEvent, 'timestamp'> & { timestamp?: string }
): void {
    const normalized: EvalTraceEvent = {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
    };
    fs.appendFileSync(tracePath, `${JSON.stringify(normalized)}\n`, 'utf8');
}

export function readEvalTrace(tracePath: string): EvalTraceEvent[] {
    if (!fs.existsSync(tracePath)) {
        return [];
    }
    return fs.readFileSync(tracePath, 'utf8')
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as EvalTraceEvent);
}
