import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  findAgentScenario,
  gradeAgentRun,
  prepareAgentScenario,
} from './agent-scenario-lib.mjs';
import { resolveBrowserPath, resolveVsCodePath } from './runtime-paths.mjs';

const DEFAULT_SCENARIO_ID = 'read-code-call-chain';
const DEFAULT_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_SETUP_DELAY_MS = 0;
const SAFE_LOCAL_TOOLS = [
  'edit_file',
  'get_project_context',
  'get_project_rules',
  'list_skills',
  'list_tools',
  'read_file',
  'search_code',
  'search_files',
  'write_file',
];

const evalsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarioId = process.argv[2]?.trim() || DEFAULT_SCENARIO_ID;
const scenario = await findAgentScenario(evalsRoot, scenarioId);
const run = await prepareAgentScenario(evalsRoot, scenario);
const startedAt = new Date().toISOString();
const browserPath = resolveBrowserPath();
const vscodePath = resolveVsCodePath();
const profilePath = path.resolve(
  process.env.WEBCODE_LIVE_PROFILE_PATH?.trim()
    || path.join(evalsRoot, 'live-profiles', 'deepseek')
);
const approvedTools = resolveApprovedTools();

await fs.mkdir(profilePath, { recursive: true });
await updateRunManifest({
  status: 'running',
  startedAt,
  liveSite: 'deepseek',
  browserPath,
  vscodePath: vscodePath ?? 'downloaded-test-runtime',
  profilePath,
  approvedTools,
});
await appendRunnerTrace('run_started', 'started', {
  approvedTools,
  browserPath,
  profilePath,
  scenarioId,
  vscodePath: vscodePath ?? 'downloaded-test-runtime',
  workspacePath: run.workspacePath,
});

console.log(`Starting DeepSeek live evaluation: ${scenario.id}`);
console.log(`Persistent browser profile: ${profilePath}`);
console.log('If the isolated Edge window is logged out, sign in there. The run resumes automatically.');

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
  path.join(evalsRoot, '.vscode-test.deepseek.mjs'),
], {
  cwd: evalsRoot,
  env: {
    ...process.env,
    WEBCODE_EVAL_BROWSER_PATH: browserPath,
    WEBCODE_EVAL_RUN_DIR: run.runDirectory,
    WEBCODE_EVAL_SCENARIO_PATH: scenario.manifestPath,
    WEBCODE_EVAL_TRACE_PATH: run.tracePath,
    WEBCODE_EVAL_VSCODE_PATH: vscodePath,
    WEBCODE_EVAL_WORKSPACE: run.workspacePath,
    WEBCODE_LIVE_APPROVED_TOOLS: approvedTools.join(','),
    WEBCODE_LIVE_DEEP_THINKING: readBooleanFlag('WEBCODE_LIVE_DEEP_THINKING'),
    WEBCODE_LIVE_LOGIN_TIMEOUT_MS: readTimeout(
      'WEBCODE_LIVE_LOGIN_TIMEOUT_MS',
      DEFAULT_LOGIN_TIMEOUT_MS
    ),
    WEBCODE_LIVE_MODEL_MODE: readModelMode(),
    WEBCODE_LIVE_PROFILE_PATH: profilePath,
    WEBCODE_LIVE_SETUP_DELAY_MS: readDelay(
      'WEBCODE_LIVE_SETUP_DELAY_MS',
      DEFAULT_SETUP_DELAY_MS
    ),
    WEBCODE_LIVE_RUN_TIMEOUT_MS: readTimeout(
      'WEBCODE_LIVE_RUN_TIMEOUT_MS',
      Math.max(DEFAULT_RUN_TIMEOUT_MS, scenario.timeoutMs)
    ),
  },
  shell: false,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
await appendRunnerTrace('browser_execution_finished', exitCode === 0 ? 'success' : 'error', { exitCode });

let grade;
let gradePath;
let graderError;
try {
  const graded = await gradeAgentRun(run.runDirectory);
  grade = graded.result;
  gradePath = graded.gradePath;
} catch (error) {
  graderError = error instanceof Error ? error.message : String(error);
}

const preliminaryTrace = await readTrace(run.tracePath);
const passed = exitCode === 0 && grade?.passed === true && !graderError;
const failureCategory = passed
  ? undefined
  : classifyFailure(preliminaryTrace, exitCode, grade, graderError);
const reportPath = path.join(run.runDirectory, 'live-report.json');
await appendRunnerTrace('run_finished', passed ? 'success' : 'error', {
  exitCode,
  failureCategory,
  reportPath,
  score: grade?.score,
});
const trace = await readTrace(run.tracePath);
const conversation = await fs.readFile(
  path.join(run.runDirectory, 'deepseek-conversation.txt'),
  'utf8'
).catch(() => '');
const protocolNearMissDetected = detectProtocolNearMiss(trace, conversation);
const warnings = collectWarnings(trace, protocolNearMissDetected);
const report = {
  schemaVersion: 1,
  runId: run.runId,
  scenarioId: scenario.id,
  site: 'deepseek',
  status: passed ? 'passed' : 'failed',
  passed,
  failureCategory,
  startedAt,
  completedAt: new Date().toISOString(),
  exitCode,
  browserPath,
  vscodePath: vscodePath ?? 'downloaded-test-runtime',
  profilePath,
  approvedTools,
  gradePath,
  grade,
  graderError,
  protocolNearMissDetected,
  trace: summarizeTrace(trace),
  warnings,
  artifacts: {
    conversation: path.join(run.runDirectory, 'deepseek-conversation.txt'),
    page: path.join(run.runDirectory, 'deepseek-page.json'),
    screenshot: path.join(run.runDirectory, `deepseek-${exitCode === 0 ? 'passed' : 'failed'}.png`),
    trace: run.tracePath,
    workspace: run.workspacePath,
  },
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await updateRunManifest({
  status: passed ? 'passed' : 'failed',
  completedAt: report.completedAt,
  exitCode,
  failureCategory,
  liveReportPath: reportPath,
  gradePath,
  score: grade?.score,
});
console.log(`DeepSeek live evaluation ${passed ? 'passed' : 'failed'}.`);
console.log(`Failure category: ${failureCategory ?? 'none'}`);
console.log(`Run artifacts: ${run.runDirectory}`);
process.exitCode = passed ? 0 : 1;

function resolveApprovedTools() {
  const configured = process.env.WEBCODE_LIVE_APPROVED_TOOLS?.trim();
  if (configured) {
    return [...new Set(configured.split(',').map(value => value.trim()).filter(Boolean))];
  }
  return [...new Set([
    ...SAFE_LOCAL_TOOLS,
    ...scenario.requiredToolCalls.map(requirement => requirement.name),
  ])];
}

function readTimeout(name, fallback) {
  const configured = process.env[name]?.trim();
  if (!configured) {
    return String(fallback);
  }
  const value = Number(configured);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return String(value);
}

function readDelay(name, fallback) {
  const configured = process.env[name]?.trim();
  if (!configured) {
    return String(fallback);
  }
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return String(value);
}

function readModelMode() {
  const value = process.env.WEBCODE_LIVE_MODEL_MODE?.trim();
  if (!value) {
    return undefined;
  }
  if (value !== 'expert') {
    throw new Error('WEBCODE_LIVE_MODEL_MODE currently supports only "expert".');
  }
  return value;
}

function readBooleanFlag(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    return undefined;
  }
  if (value !== '0' && value !== '1') {
    throw new Error(`${name} must be "0" or "1".`);
  }
  return value;
}

async function updateRunManifest(patch) {
  const manifest = JSON.parse(await fs.readFile(run.runManifestPath, 'utf8'));
  await fs.writeFile(run.runManifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`, 'utf8');
}

async function appendRunnerTrace(event, status, details) {
  const record = {
    timestamp: new Date().toISOString(),
    runId: run.runId,
    source: 'runner',
    event,
    status,
    details,
  };
  await fs.appendFile(run.tracePath, `${JSON.stringify(record)}\n`, 'utf8');
}

async function readTrace(tracePath) {
  const content = await fs.readFile(tracePath, 'utf8').catch(() => '');
  return content.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function classifyFailure(trace, exitCode, grade, graderError) {
  if (graderError) {
    return 'grader';
  }
  if (!hasSuccessfulEvent(trace, 'deepseek_login_ready')) {
    return 'environment';
  }
  if (trace.some(event => event.source === 'gateway' && event.status === 'error')) {
    return 'gateway';
  }
  if (exitCode !== 0 || !hasSuccessfulEvent(trace, 'deepseek_response_settled')) {
    return 'site';
  }
  if (grade && !grade.passed) {
    return 'model';
  }
  return 'environment';
}

function hasSuccessfulEvent(trace, eventName) {
  return trace.some(event => event.event === eventName && event.status === 'success');
}

function collectWarnings(trace, protocolNearMissDetected) {
  const warnings = trace.flatMap(event => {
    if (event.event === 'deepseek_send_selector_fallback') {
      return [`Configured send selector failed: ${event.details?.selector ?? 'unknown'}`];
    }
    if (event.event === 'live_tool_manual_approval_required') {
      return [`Manual approval requested: ${event.details?.toolName ?? 'unknown'}`];
    }
    return [];
  });
  if (protocolNearMissDetected) {
    warnings.push('Model emitted tool-like Calling blocks, but no post-task Gateway tool call was executed.');
  }
  return warnings;
}

function summarizeTrace(trace) {
  const toolCalls = trace.filter(event => event.event === 'tool_call_started');
  const taskSentIndex = trace.findIndex(event => event.event === 'deepseek_task_sent');
  const postTaskToolCalls = taskSentIndex < 0
    ? []
    : trace.slice(taskSentIndex + 1).filter(event => event.event === 'tool_call_started');
  return {
    events: trace.length,
    toolCalls: toolCalls.length,
    tools: toolCalls.map(event => event.toolName).filter(Boolean),
    postTaskToolCalls: postTaskToolCalls.length,
    postTaskTools: postTaskToolCalls.map(event => event.toolName).filter(Boolean),
    automaticApprovals: trace.filter(event => event.event === 'live_tool_auto_approved').length,
    manualApprovalPrompts: trace.filter(event => event.event === 'live_tool_manual_approval_required').length,
  };
}

function detectProtocolNearMiss(trace, conversation) {
  const taskSentIndex = trace.findIndex(event => event.event === 'deepseek_task_sent');
  const postTaskToolCall = taskSentIndex >= 0
    && trace.slice(taskSentIndex + 1).some(event => event.event === 'tool_call_started');
  return !postTaskToolCall && /Calling:\s*[a-z][a-z0-9_:]*/i.test(conversation);
}
