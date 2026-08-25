import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { resolveBrowserPath, resolveVsCodePath } from './runtime-paths.mjs';

const require = createRequire(import.meta.url);
const { loadScenario } = require('../out/harness/scenario.js');
const { prepareEvalRun } = require('../out/harness/runWorkspace.js');
const { appendEvalTrace } = require('../out/harness/trace.js');

const evalsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(evalsRoot, '..');
const scenarioId = process.argv[2]?.trim() || 'minimal-tool-loop';
const testFile = process.argv[3]?.trim() || 'minimalE2E.test.js';
if (!/^[A-Za-z0-9._-]+$/.test(scenarioId) || !/^[A-Za-z0-9._-]+\.test\.js$/.test(testFile)) {
  throw new Error('E2E scenario id or compiled test filename contains unsupported characters.');
}
const scenarioPath = path.join(evalsRoot, 'scenarios', scenarioId, 'scenario.json');
const scenario = await loadScenario(scenarioPath);
const run = await prepareEvalRun(evalsRoot, scenario);
const startedAt = new Date().toISOString();
const browserPath = resolveBrowserPath();
const vscodePath = resolveVsCodePath();

await writeRunManifest('running');
appendEvalTrace(run.tracePath, {
  runId: run.runId,
  source: 'runner',
  event: 'run_started',
  status: 'started',
  details: {
    browserPath,
    scenarioId: scenario.id,
    vscodePath: vscodePath ?? 'downloaded-test-runtime',
    workspacePath: run.workspacePath,
  },
});

const vscodeTestCliPath = path.join(
  evalsRoot,
  'node_modules',
  '@vscode',
  'test-cli',
  'out',
  'bin.mjs'
);
const child = spawn(process.execPath, [
  vscodeTestCliPath,
  '--config',
  path.join(evalsRoot, '.vscode-test.mjs'),
], {
  cwd: evalsRoot,
  env: {
    ...process.env,
    WEBCODE_EVAL_BROWSER_PATH: browserPath,
    WEBCODE_EVAL_RUN_DIR: run.runDirectory,
    WEBCODE_EVAL_SCENARIO_PATH: scenarioPath,
    WEBCODE_EVAL_TEST_FILE: `out/extension-test/${testFile}`,
    WEBCODE_EVAL_TRACE_PATH: run.tracePath,
    WEBCODE_EVAL_VSCODE_PATH: vscodePath,
    WEBCODE_EVAL_WORKSPACE: run.workspacePath,
  },
  shell: false,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});

const status = exitCode === 0 ? 'passed' : 'failed';
appendEvalTrace(run.tracePath, {
  runId: run.runId,
  source: 'runner',
  event: 'run_finished',
  status: exitCode === 0 ? 'success' : 'error',
  details: { exitCode },
});
await writeRunManifest(status, exitCode);

console.log(`webcode ${scenario.id} E2E ${status}.`);
console.log(`Run artifacts: ${run.runDirectory}`);
process.exitCode = exitCode;

async function writeRunManifest(status, exitCode) {
  const traceEvents = await countTraceEvents(run.tracePath);
  await writeFile(run.runManifestPath, `${JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    scenarioId: scenario.id,
    status,
    startedAt,
    completedAt: status === 'running' ? undefined : new Date().toISOString(),
    exitCode,
    workspacePath: run.workspacePath,
    tracePath: run.tracePath,
    traceEvents,
  }, null, 2)}\n`, 'utf8');
}

async function countTraceEvents(tracePath) {
  const content = await readFile(tracePath, 'utf8').catch(() => '');
  return content.split(/\r?\n/).filter(line => line.trim()).length;
}
