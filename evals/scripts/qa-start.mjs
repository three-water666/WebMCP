import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import {
  evalsRoot,
  findAvailablePort,
  readJson,
  repoRoot,
  requestControl,
  runPlaywright,
  spawnDetachedNode,
  updateRunManifest,
  waitForHttp,
  waitForJson,
  writeJson,
} from './qa-common.mjs';
import { resolveBrowserPath, resolveVsCodePath } from './runtime-paths.mjs';
import { findAgentScenario, prepareAgentScenario } from './agent-scenario-lib.mjs';

const require = createRequire(import.meta.url);
const { loadScenario } = require('../out/harness/scenario.js');
const { prepareEvalRun } = require('../out/harness/runWorkspace.js');

const { siteId, scenarioId } = readArguments(process.argv.slice(2));
const { run, scenario } = await prepareScenario(scenarioId);
const browserPath = resolveBrowserPath();
const vscodePath = resolveVsCodePath();
const gatewayPort = await findAvailablePort(Array.from({ length: 10 }, (_, index) => 34567 + index));
const browserCdpPort = await findDistinctPort(new Set([gatewayPort]));
const vscodeCdpPort = await findDistinctPort(new Set([gatewayPort, browserCdpPort]));
const token = randomBytes(24).toString('hex');
const startedAt = new Date().toISOString();
const profilePath = path.resolve(
  process.env.WEBCODE_QA_PROFILE_PATH?.trim()
    || path.join(evalsRoot, 'live-profiles', sanitizeSegment(siteId))
);
const browserReadyPath = path.join(run.runDirectory, 'browser-host.json');
const browserStopPath = path.join(run.runDirectory, 'browser-host.stop');
const controlPath = path.join(run.runDirectory, 'control.json');
const logsDirectory = path.join(run.runDirectory, 'logs');
const artifactsDirectory = path.join(run.runDirectory, 'artifacts');
const sessions = {
  browser: `${run.runId}-browser`,
  vscode: `${run.runId}-vscode`,
};

await fs.mkdir(logsDirectory, { recursive: true });
await fs.mkdir(artifactsDirectory, { recursive: true });
await prepareVsCodeUserData();
const preparedManifest = await readJson(run.runManifestPath).catch(() => ({}));
await writeJson(run.runManifestPath, {
  ...preparedManifest,
  schemaVersion: 1,
  kind: 'interactive-qa',
  runId: run.runId,
  scenarioId: scenario.id,
  scenarioKind: scenario.kind,
  scenarioTitle: scenario.title,
  ...(scenario.kind === 'agent-eval'
    ? { category: scenario.category, difficulty: scenario.difficulty }
    : {}),
  fixturePath: scenario.fixturePath,
  siteId,
  status: 'starting',
  startedAt,
  workspacePath: run.workspacePath,
  tracePath: run.tracePath,
  profilePath,
  browserPath,
  vscodePath: vscodePath ?? 'downloaded-test-runtime',
  gatewayPort,
  sessions,
  artifactsDirectory,
  logsDirectory,
});

try {
  const vscodeProcessId = startVsCodeHost();
  const control = await waitForJson(controlPath, 120_000);
  let manifest = await updateRunManifest(run.runDirectory, {
    control: { port: control.port, token },
    processes: { vscodeTestCli: vscodeProcessId },
  });
  const initialFile = await findInitialWorkspaceFile(run.workspacePath);
  if (initialFile) {
    await requestControl(manifest, 'vscode.openFile', { path: initialFile });
    manifest = await updateRunManifest(run.runDirectory, { initialFile });
  }
  const site = await requestControl(manifest, 'site.start', { siteId });
  const browserProcessId = startBrowserHost(site.bridgeUrl, site.site.address);
  const browserHost = await waitForJson(browserReadyPath, 120_000);
  if (browserHost.status !== 'ready') {
    throw new Error(browserHost.error || 'QA browser host failed to start.');
  }

  await waitForHttp(browserCdpPort);
  await waitForHttp(vscodeCdpPort, 120_000);
  const browserConfigPath = await writePlaywrightConfig('browser', browserCdpPort);
  const vscodeConfigPath = await writePlaywrightConfig('vscode', vscodeCdpPort);
  await attachPlaywright(sessions.browser, browserCdpPort, browserConfigPath);
  await attachPlaywright(sessions.vscode, vscodeCdpPort, vscodeConfigPath);

  manifest = await updateRunManifest(run.runDirectory, {
    status: 'running',
    readyAt: new Date().toISOString(),
    bridgeUrl: site.bridgeUrl,
    targetUrl: site.site.address,
    control: { port: control.port, token },
    endpoints: {
      browserCdp: `http://127.0.0.1:${browserCdpPort}`,
      vscodeCdp: `http://127.0.0.1:${vscodeCdpPort}`,
    },
    playwrightConfigs: {
      browser: browserConfigPath,
      vscode: vscodeConfigPath,
    },
    browser: browserHost,
    popupUrl: browserHost.popupUrl,
    processes: {
      ...manifest.processes,
      browserHost: browserProcessId,
    },
  });
  await appendTrace('qa_session_ready', 'success', {
    browserSession: sessions.browser,
    siteId,
    vscodeSession: sessions.vscode,
  });
  printReady(manifest);
} catch (error) {
  await updateRunManifest(run.runDirectory, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  });
  await stopPartialRun();
  console.error(`QA session failed to start: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Run artifacts: ${run.runDirectory}`);
  process.exitCode = 1;
}

function startVsCodeHost() {
  const vscodeTestCliPath = path.join(
    evalsRoot,
    'node_modules',
    '@vscode',
    'test-cli',
    'out',
    'bin.mjs'
  );
  const env = {
    ...process.env,
    WEBCODE_EVAL_RUN_DIR: run.runDirectory,
    WEBCODE_EVAL_TRACE_PATH: run.tracePath,
    WEBCODE_EVAL_VSCODE_PATH: vscodePath,
    WEBCODE_EVAL_WORKSPACE: run.workspacePath,
    WEBCODE_QA_CONTROL_TOKEN: token,
    WEBCODE_QA_GATEWAY_PORT: String(gatewayPort),
    WEBCODE_QA_VSCODE_CDP_PORT: String(vscodeCdpPort),
    ...(run.gatewayConfigPath
      ? { WEBCODE_QA_GATEWAY_CONFIG_PATH: run.gatewayConfigPath }
      : {}),
  };
  return spawnDetachedNode(vscodeTestCliPath, [
    '--config',
    path.join(evalsRoot, '.vscode-test.qa.mjs'),
  ], {
    env,
    stdoutPath: path.join(logsDirectory, 'vscode.stdout.log'),
    stderrPath: path.join(logsDirectory, 'vscode.stderr.log'),
  });
}

async function prepareVsCodeUserData() {
  const userDirectory = path.join(run.runDirectory, 'vscode-user-data', 'User');
  await fs.mkdir(userDirectory, { recursive: true });
  await writeJson(path.join(userDirectory, 'settings.json'), {
    'git.openRepositoryInParentFolders': 'never',
  });
}

function startBrowserHost(bridgeUrl, targetUrl) {
  const extensionPath = path.join(repoRoot, 'bridge-browser', 'dist');
  return spawnDetachedNode(path.join(evalsRoot, 'scripts', 'qa-browser-host.mjs'), [
    `--bridgeUrl=${bridgeUrl}`,
    `--browserPath=${browserPath}`,
    `--cdpPort=${browserCdpPort}`,
    `--extensionPath=${extensionPath}`,
    `--gatewayPort=${gatewayPort}`,
    `--profilePath=${profilePath}`,
    `--readyPath=${browserReadyPath}`,
    `--siteId=${siteId}`,
    `--stopPath=${browserStopPath}`,
    `--targetUrl=${targetUrl}`,
  ], {
    env: process.env,
    stdoutPath: path.join(logsDirectory, 'browser.stdout.log'),
    stderrPath: path.join(logsDirectory, 'browser.stderr.log'),
  });
}

async function writePlaywrightConfig(target, cdpPort) {
  const outputDirectory = path.join(artifactsDirectory, target);
  const configPath = path.join(run.runDirectory, `playwright-${target}.json`);
  await fs.mkdir(outputDirectory, { recursive: true });
  await writeJson(configPath, {
    browser: {
      browserName: 'chromium',
      cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
      cdpTimeout: 30_000,
    },
    outputDir: outputDirectory,
    outputMode: 'stdout',
    console: { level: 'debug' },
    codegen: 'typescript',
    timeouts: {
      action: 10_000,
      navigation: 60_000,
    },
  });
  return configPath;
}

async function attachPlaywright(sessionName, cdpPort, configPath) {
  const result = await runPlaywright(sessionName, [
    'attach',
    `--cdp=http://127.0.0.1:${cdpPort}`,
    `--config=${configPath}`,
  ], { capture: true });
  if (result.code !== 0) {
    throw new Error(`Could not attach Playwright session ${sessionName}: ${result.stderr || result.stdout}`);
  }
}

async function stopPartialRun() {
  await fs.writeFile(browserStopPath, 'stop\n', 'utf8').catch(() => undefined);
  const manifest = await updateRunManifest(run.runDirectory, {}).catch(() => undefined);
  if (manifest?.control) {
    await requestControl(manifest, 'stop').catch(() => undefined);
  }
  await runPlaywright(sessions.browser, ['detach'], { capture: true }).catch(() => undefined);
  await runPlaywright(sessions.vscode, ['detach'], { capture: true }).catch(() => undefined);
}

async function appendTrace(event, status, details) {
  await fs.appendFile(run.tracePath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    runId: run.runId,
    source: 'qa-runner',
    event,
    status,
    details,
  })}\n`, 'utf8');
}

async function findDistinctPort(excluded) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await findAvailablePort();
    if (!excluded.has(port)) {
      return port;
    }
  }
  throw new Error('Could not reserve distinct QA control ports.');
}

function readArguments(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: pnpm qa:start [chatgpt|deepseek|site-id] [agent-scenario-id]');
    process.exit(0);
  }
  const siteId = args[0]?.trim() || 'chatgpt';
  const scenarioId = args[1]?.trim() || 'minimal-tool-loop';
  for (const [label, value] of [['site', siteId], ['scenario', scenarioId]]) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
      throw new Error(`Invalid ${label} id: ${value}`);
    }
  }
  if (args.length > 2) {
    throw new Error('qa:start accepts at most a site id and an agent scenario id.');
  }
  return { siteId, scenarioId };
}

async function prepareScenario(scenarioId) {
  if (scenarioId !== 'minimal-tool-loop') {
    const scenario = await findAgentScenario(evalsRoot, scenarioId);
    return { scenario, run: await prepareAgentScenario(evalsRoot, scenario) };
  }
  const scenarioPath = path.join(evalsRoot, 'scenarios', scenarioId, 'scenario.json');
  const scenario = await loadScenario(scenarioPath);
  return { scenario, run: await prepareEvalRun(evalsRoot, scenario) };
}

async function findInitialWorkspaceFile(workspacePath) {
  const files = await collectWorkspaceFiles(workspacePath);
  const preferredExtensions = new Set([
    '.c', '.cpp', '.cs', '.css', '.go', '.html', '.java', '.js', '.jsx', '.json', '.mjs',
    '.php', '.py', '.rb', '.rs', '.ts', '.tsx', '.vue',
  ]);
  return files.find(file => preferredExtensions.has(path.extname(file).toLowerCase())) ?? files[0];
}

async function collectWorkspaceFiles(workspacePath, directory = workspacePath) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectWorkspaceFiles(workspacePath, absolutePath));
    } else if (entry.isFile()) {
      files.push(path.relative(workspacePath, absolutePath));
    }
  }
  return files;
}

function sanitizeSegment(value) {
  return value.replace(/[^a-z0-9_-]/gi, '-');
}

function printReady(manifest) {
  console.log(`Interactive QA session ready: ${manifest.runId}`);
  console.log(`Site: ${manifest.siteId}`);
  console.log(`Scenario: ${manifest.scenarioId} (${manifest.scenarioTitle})`);
  console.log(`Workspace: ${manifest.workspacePath}`);
  console.log(`Run artifacts: ${run.runDirectory}`);
  console.log(`Browser: pnpm qa:pw ${manifest.runId} browser snapshot`);
  console.log(`VS Code: pnpm qa:pw ${manifest.runId} vscode snapshot`);
  console.log(`State: pnpm qa:ctl ${manifest.runId} status`);
  if (manifest.taskPath) {
    console.log(`Task: pnpm qa:ctl ${manifest.runId} task`);
  }
  console.log(`Review: pnpm qa:ctl ${manifest.runId} review`);
  console.log(`Stop: pnpm qa:stop ${manifest.runId}`);
}
