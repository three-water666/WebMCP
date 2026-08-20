import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ScenarioExpected {
    readPath: string;
    readContains: string;
    writtenPath: string;
    writtenContent: string;
    toolCalls: string[];
}

export interface EvalScenario {
    schemaVersion: 1;
    id: string;
    title: string;
    kind: 'contract-e2e' | 'agent-eval' | 'live-smoke';
    fixture: string;
    fixturePath: string;
    timeoutMs: number;
    expected: ScenarioExpected;
}

type ScenarioManifest = Omit<EvalScenario, 'fixturePath'>;

export async function loadScenario(manifestPath: string): Promise<EvalScenario> {
    const absoluteManifestPath = path.resolve(manifestPath);
    const parsed = JSON.parse(await fs.readFile(absoluteManifestPath, 'utf8')) as unknown;
    const manifest = validateScenarioManifest(parsed, absoluteManifestPath);
    const fixturePath = path.resolve(path.dirname(absoluteManifestPath), manifest.fixture);

    const fixtureStats = await fs.stat(fixturePath).catch(() => null);
    if (!fixtureStats?.isDirectory()) {
        throw new Error(`Scenario fixture directory does not exist: ${fixturePath}`);
    }

    return {
        ...manifest,
        fixturePath,
    };
}

function validateScenarioManifest(value: unknown, manifestPath: string): ScenarioManifest {
    if (!isRecord(value)) {
        throw new Error(`Scenario manifest must be a JSON object: ${manifestPath}`);
    }
    if (value.schemaVersion !== 1) {
        throw new Error(`Unsupported scenario schemaVersion in ${manifestPath}`);
    }

    const kind = requireString(value, 'kind', manifestPath);
    if (kind !== 'contract-e2e' && kind !== 'agent-eval' && kind !== 'live-smoke') {
        throw new Error(`Invalid scenario kind in ${manifestPath}: ${kind}`);
    }

    if (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) <= 0) {
        throw new Error(`Scenario timeoutMs must be a positive integer: ${manifestPath}`);
    }

    const expected = validateExpected(value.expected, manifestPath);
    return {
        schemaVersion: 1,
        id: requireString(value, 'id', manifestPath),
        title: requireString(value, 'title', manifestPath),
        kind,
        fixture: requireString(value, 'fixture', manifestPath),
        timeoutMs: Number(value.timeoutMs),
        expected,
    };
}

function validateExpected(value: unknown, manifestPath: string): ScenarioExpected {
    if (!isRecord(value)) {
        throw new Error(`Scenario expected must be a JSON object: ${manifestPath}`);
    }

    if (!Array.isArray(value.toolCalls) || value.toolCalls.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(`Scenario expected.toolCalls must be a non-empty string array: ${manifestPath}`);
    }

    return {
        readPath: requireString(value, 'readPath', manifestPath),
        readContains: requireString(value, 'readContains', manifestPath),
        writtenPath: requireString(value, 'writtenPath', manifestPath),
        writtenContent: requireString(value, 'writtenContent', manifestPath),
        toolCalls: value.toolCalls.map(item => String(item)),
    };
}

function requireString(record: Record<string, unknown>, key: string, manifestPath: string): string {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Scenario ${key} must be a non-empty string: ${manifestPath}`);
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
