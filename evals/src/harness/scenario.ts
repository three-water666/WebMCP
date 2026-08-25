import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ScenarioExpected {
    readPath: string;
    readContains: string;
    writtenPath: string;
    writtenContent: string;
    toolCalls: string[];
}

interface BaseEvalScenario {
    schemaVersion: 1;
    id: string;
    title: string;
    fixture: string;
    fixturePath: string;
    manifestPath: string;
    timeoutMs: number;
}

export interface ContractE2EScenario extends BaseEvalScenario {
    kind: 'contract-e2e';
    expected: ScenarioExpected;
}

export interface LiveSmokeScenario extends BaseEvalScenario {
    kind: 'live-smoke';
    expected: ScenarioExpected;
}

export type AgentScenarioCategory =
    | 'read-code'
    | 'implement-feature'
    | 'fix-bug'
    | 'write-tests'
    | 'follow-skill'
    | 'use-mcp';

export type AgentScenarioDifficulty = 'easy' | 'medium' | 'hard';

export interface RequiredToolCall {
    name: string;
    minimum: number;
    arguments?: Record<string, string | number | boolean>;
}

export interface AgentMcpServer {
    id: string;
    type: 'stdio';
    command: string;
    args: string[];
    resolvedArgs: string[];
}

export interface AgentEvalScenario extends BaseEvalScenario {
    kind: 'agent-eval';
    category: AgentScenarioCategory;
    difficulty: AgentScenarioDifficulty;
    task: string;
    taskPath: string;
    grader: string;
    graderPath: string;
    requiredToolCalls: RequiredToolCall[];
    mcpServers: AgentMcpServer[];
}

export type EvalScenario = ContractE2EScenario | AgentEvalScenario | LiveSmokeScenario;

interface ValidatedBaseManifest {
    schemaVersion: 1;
    id: string;
    title: string;
    kind: EvalScenario['kind'];
    fixture: string;
    timeoutMs: number;
    raw: Record<string, unknown>;
}

const AGENT_CATEGORIES = new Set<AgentScenarioCategory>([
    'read-code',
    'implement-feature',
    'fix-bug',
    'write-tests',
    'follow-skill',
    'use-mcp',
]);
const AGENT_DIFFICULTIES = new Set<AgentScenarioDifficulty>(['easy', 'medium', 'hard']);

export async function loadScenario(manifestPath: string): Promise<EvalScenario> {
    const absoluteManifestPath = path.resolve(manifestPath);
    const parsed = JSON.parse(await fs.readFile(absoluteManifestPath, 'utf8')) as unknown;
    const manifest = validateBaseManifest(parsed, absoluteManifestPath);
    const fixturePath = await resolveRequiredPath(
        path.dirname(absoluteManifestPath),
        manifest.fixture,
        'directory',
        'fixture'
    );

    if (manifest.kind === 'agent-eval') {
        return loadAgentScenario(manifest, fixturePath, absoluteManifestPath);
    }

    return {
        schemaVersion: 1,
        id: manifest.id,
        title: manifest.title,
        kind: manifest.kind,
        fixture: manifest.fixture,
        fixturePath,
        manifestPath: absoluteManifestPath,
        timeoutMs: manifest.timeoutMs,
        expected: validateExpected(manifest.raw.expected, absoluteManifestPath),
    };
}

export async function discoverAgentScenarios(scenariosRoot: string): Promise<AgentEvalScenario[]> {
    const manifests = await findScenarioManifests(path.resolve(scenariosRoot));
    const scenarios = await Promise.all(manifests.map(loadScenario));
    return scenarios
        .filter((scenario): scenario is AgentEvalScenario => scenario.kind === 'agent-eval')
        .sort((left, right) => left.id.localeCompare(right.id));
}

async function loadAgentScenario(
    manifest: ReturnType<typeof validateBaseManifest>,
    fixturePath: string,
    manifestPath: string
): Promise<AgentEvalScenario> {
    const directory = path.dirname(manifestPath);
    const parsed = manifest.raw;
    const category = requireString(parsed, 'category', manifestPath) as AgentScenarioCategory;
    const difficulty = requireString(parsed, 'difficulty', manifestPath) as AgentScenarioDifficulty;
    if (!AGENT_CATEGORIES.has(category)) {
        throw new Error(`Invalid agent scenario category in ${manifestPath}: ${category}`);
    }
    if (!AGENT_DIFFICULTIES.has(difficulty)) {
        throw new Error(`Invalid agent scenario difficulty in ${manifestPath}: ${difficulty}`);
    }

    const task = requireString(parsed, 'task', manifestPath);
    const grader = requireString(parsed, 'grader', manifestPath);
    const taskPath = await resolveRequiredPath(directory, task, 'file', 'task');
    const graderPath = await resolveRequiredPath(directory, grader, 'file', 'grader');

    return {
        schemaVersion: 1,
        id: manifest.id,
        title: manifest.title,
        kind: 'agent-eval',
        fixture: manifest.fixture,
        fixturePath,
        manifestPath,
        timeoutMs: manifest.timeoutMs,
        category,
        difficulty,
        task,
        taskPath,
        grader,
        graderPath,
        requiredToolCalls: validateRequiredToolCalls(parsed.requiredToolCalls, manifestPath),
        mcpServers: validateMcpServers(parsed.mcpServers, directory, manifestPath),
    };
}

function validateBaseManifest(value: unknown, manifestPath: string): ValidatedBaseManifest {
    if (!isRecord(value)) {
        throw new Error(`Scenario manifest must be a JSON object: ${manifestPath}`);
    }
    if (value.schemaVersion !== 1) {
        throw new Error(`Unsupported scenario schemaVersion in ${manifestPath}`);
    }

    const rawKind = requireString(value, 'kind', manifestPath);
    if (rawKind !== 'contract-e2e' && rawKind !== 'agent-eval' && rawKind !== 'live-smoke') {
        throw new Error(`Invalid scenario kind in ${manifestPath}: ${rawKind}`);
    }
    const kind = rawKind;
    if (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) <= 0) {
        throw new Error(`Scenario timeoutMs must be a positive integer: ${manifestPath}`);
    }

    return {
        schemaVersion: 1 as const,
        id: requireString(value, 'id', manifestPath),
        title: requireString(value, 'title', manifestPath),
        kind,
        fixture: requireString(value, 'fixture', manifestPath),
        timeoutMs: Number(value.timeoutMs),
        raw: value,
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
        toolCalls: value.toolCalls.map(String),
    };
}

function validateRequiredToolCalls(value: unknown, manifestPath: string): RequiredToolCall[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`Scenario requiredToolCalls must be an array: ${manifestPath}`);
    }

    return value.map((item, index) => {
        if (!isRecord(item)) {
            throw new Error(`Scenario requiredToolCalls[${index}] must be an object: ${manifestPath}`);
        }
        const minimum = item.minimum ?? 1;
        if (!Number.isInteger(minimum) || Number(minimum) <= 0) {
            throw new Error(`Scenario requiredToolCalls[${index}].minimum must be positive: ${manifestPath}`);
        }

        return {
            name: requireString(item, 'name', manifestPath),
            minimum: Number(minimum),
            arguments: validateEvidenceArguments(item.arguments, manifestPath, index),
        };
    });
}

function validateEvidenceArguments(
    value: unknown,
    manifestPath: string,
    index: number
): Record<string, string | number | boolean> | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error(`Scenario requiredToolCalls[${index}].arguments must be an object: ${manifestPath}`);
    }
    for (const argument of Object.values(value)) {
        if (typeof argument !== 'string' && typeof argument !== 'number' && typeof argument !== 'boolean') {
            throw new Error(`Scenario tool evidence arguments must contain primitive values: ${manifestPath}`);
        }
    }
    return value as Record<string, string | number | boolean>;
}

function validateMcpServers(value: unknown, directory: string, manifestPath: string): AgentMcpServer[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`Scenario mcpServers must be an array: ${manifestPath}`);
    }

    return value.map((item, index) => {
        if (!isRecord(item) || item.type !== 'stdio') {
            throw new Error(`Scenario mcpServers[${index}] must be a stdio server: ${manifestPath}`);
        }
        if (!Array.isArray(item.args) || item.args.some(argument => typeof argument !== 'string')) {
            throw new Error(`Scenario mcpServers[${index}].args must be a string array: ${manifestPath}`);
        }
        const args = item.args.map(String);
        return {
            id: requireString(item, 'id', manifestPath),
            type: 'stdio',
            command: requireString(item, 'command', manifestPath),
            args,
            resolvedArgs: args.map(argument => (
                argument.startsWith('./') ? path.resolve(directory, argument) : argument
            )),
        };
    });
}

async function findScenarioManifests(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const manifests: string[] = [];
    for (const entry of entries) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            manifests.push(...await findScenarioManifests(entryPath));
        } else if (entry.isFile() && entry.name === 'scenario.json') {
            manifests.push(entryPath);
        }
    }
    return manifests;
}

async function resolveRequiredPath(
    directory: string,
    relativePath: string,
    expectedType: 'file' | 'directory',
    label: string
): Promise<string> {
    const resolved = path.resolve(directory, relativePath);
    const stats = await fs.stat(resolved).catch(() => null);
    const valid = expectedType === 'file' ? stats?.isFile() : stats?.isDirectory();
    if (!valid) {
        throw new Error(`Scenario ${label} ${expectedType} does not exist: ${resolved}`);
    }
    return resolved;
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
