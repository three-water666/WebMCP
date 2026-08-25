import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { discoverAgentScenarios, loadScenario } = require('../out/harness/scenario.js');
const { prepareEvalRun } = require('../out/harness/runWorkspace.js');

export async function loadAgentCatalog(evalsRoot) {
  return discoverAgentScenarios(path.join(evalsRoot, 'scenarios'));
}

export async function findAgentScenario(evalsRoot, scenarioId) {
  const scenarios = await loadAgentCatalog(evalsRoot);
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown agent scenario: ${scenarioId}`);
  }
  return scenario;
}

export async function prepareAgentScenario(evalsRoot, scenario) {
  const run = await prepareEvalRun(evalsRoot, scenario);
  const taskPath = path.join(run.runDirectory, 'task.md');
  const gatewayConfigPath = path.join(run.runDirectory, 'gateway-config.json');
  await fs.copyFile(scenario.taskPath, taskPath);
  await fs.writeFile(gatewayConfigPath, `${JSON.stringify({
    servers: Object.fromEntries(scenario.mcpServers.map(server => [server.id, {
      type: server.type,
      command: server.command,
      args: server.resolvedArgs,
    }])),
  }, null, 2)}\n`, 'utf8');
  await fs.writeFile(run.runManifestPath, `${JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    scenarioId: scenario.id,
    scenarioManifestPath: scenario.manifestPath,
    category: scenario.category,
    status: 'prepared',
    preparedAt: new Date().toISOString(),
    taskPath,
    workspacePath: run.workspacePath,
    tracePath: run.tracePath,
    gatewayConfigPath,
  }, null, 2)}\n`, 'utf8');
  return { ...run, taskPath, gatewayConfigPath };
}

export async function gradeAgentRun(runDirectory) {
  const runManifestPath = path.join(path.resolve(runDirectory), 'run.json');
  const manifest = JSON.parse(await fs.readFile(runManifestPath, 'utf8'));
  const scenario = await loadScenario(manifest.scenarioManifestPath);
  if (scenario.kind !== 'agent-eval') {
    throw new Error(`Run does not reference an agent-eval scenario: ${runManifestPath}`);
  }

  const result = await gradeAgentWorkspace(scenario, manifest.workspacePath, manifest.tracePath);
  const gradePath = path.join(path.dirname(runManifestPath), 'grade.json');
  await fs.writeFile(gradePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await fs.writeFile(runManifestPath, `${JSON.stringify({
    ...manifest,
    status: result.passed ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    score: result.score,
    gradePath,
  }, null, 2)}\n`, 'utf8');
  return { result, gradePath, scenario };
}

export async function gradeAgentWorkspace(scenario, workspacePath, tracePath) {
  const graderUrl = pathToFileURL(scenario.graderPath);
  graderUrl.searchParams.set('evalRun', `${Date.now()}-${Math.random()}`);
  const grader = await import(graderUrl.href);
  if (typeof grader.grade !== 'function') {
    throw new Error(`Scenario grader must export grade(): ${scenario.graderPath}`);
  }

  const workspaceResult = validateWorkspaceGrade(await grader.grade({ workspacePath }));
  const trace = await readTrace(tracePath);
  const evidenceChecks = scenario.requiredToolCalls.map(requirement => {
    const matches = trace.filter(event => matchesToolEvidence(event, requirement));
    return {
      name: requirement.name,
      minimum: requirement.minimum,
      observed: matches.length,
      arguments: requirement.arguments,
      passed: matches.length >= requirement.minimum,
    };
  });

  return {
    passed: workspaceResult.passed && evidenceChecks.every(item => item.passed),
    score: workspaceResult.score,
    workspace: workspaceResult,
    evidence: evidenceChecks,
  };
}

export function createReferenceTrace(scenario) {
  return scenario.requiredToolCalls.flatMap(requirement => (
    Array.from({ length: requirement.minimum }, (_, index) => ({
      timestamp: new Date().toISOString(),
      source: 'gateway',
      event: 'tool_call_started',
      status: 'started',
      requestId: `reference-${requirement.name}-${index}`,
      toolName: requirement.name,
      details: { arguments: requirement.arguments ?? {} },
    }))
  ));
}

async function readTrace(tracePath) {
  if (!tracePath) {
    return [];
  }
  const content = await fs.readFile(tracePath, 'utf8').catch(() => '');
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function matchesToolEvidence(event, requirement) {
  if (event.source !== 'gateway' || event.event !== 'tool_call_started' || event.toolName !== requirement.name) {
    return false;
  }
  const observedArguments = event.details?.arguments;
  return Object.entries(requirement.arguments ?? {}).every(([key, value]) => observedArguments?.[key] === value);
}

function validateWorkspaceGrade(result) {
  if (!result || typeof result !== 'object' || typeof result.passed !== 'boolean'
    || !Number.isInteger(result.score) || !Array.isArray(result.checks)) {
    throw new Error('Scenario grader returned an invalid result.');
  }
  if (result.score < 0 || result.score > 100) {
    throw new Error(`Scenario grader score must be between 0 and 100: ${result.score}`);
  }
  return result;
}
