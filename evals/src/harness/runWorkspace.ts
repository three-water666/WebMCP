import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { EvalScenario } from './scenario';

export interface PreparedEvalRun {
    runId: string;
    runDirectory: string;
    runManifestPath: string;
    tracePath: string;
    workspacePath: string;
}

export async function prepareEvalRun(evalsRoot: string, scenario: EvalScenario): Promise<PreparedEvalRun> {
    const runId = createRunId(scenario.id);
    const runDirectory = path.join(evalsRoot, 'runs', runId);
    const workspacePath = path.join(runDirectory, 'workspace');
    const tracePath = path.join(runDirectory, 'trace.jsonl');
    const runManifestPath = path.join(runDirectory, 'run.json');

    await fs.mkdir(runDirectory, { recursive: true });
    await fs.cp(scenario.fixturePath, workspacePath, {
        recursive: true,
        errorOnExist: true,
        force: false,
    });
    await fs.writeFile(tracePath, '', 'utf8');

    return {
        runId,
        runDirectory,
        runManifestPath,
        tracePath,
        workspacePath,
    };
}

function createRunId(scenarioId: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const nonce = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${scenarioId}-${nonce}`;
}
