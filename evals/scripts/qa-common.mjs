import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const evalsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(evalsRoot, '..');
export const playwrightCliPath = path.join(
  evalsRoot,
  'node_modules',
  '@playwright',
  'cli',
  'playwright-cli.js'
);
export const playwrightDaemonDirectory = path.join(evalsRoot, '.playwright-cli', 'daemon');

export async function findAvailablePort(candidates) {
  if (candidates) {
    for (const candidate of candidates) {
      if (await canListen(candidate)) {
        return candidate;
      }
    }
    throw new Error(`No available port in ${candidates.join(', ')}.`);
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

export async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

export function isProcessRunning(processId) {
  if (!Number.isInteger(processId) || processId <= 0) {
    return false;
  }
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function waitForProcessExit(processId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(processId)) {
      return true;
    }
    await delay(200);
  }
  return !isProcessRunning(processId);
}

export async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function updateRunManifest(runDirectory, patch) {
  const manifestPath = path.join(runDirectory, 'run.json');
  const manifest = await readJson(manifestPath);
  const updated = { ...manifest, ...patch };
  await writeJson(manifestPath, updated);
  return updated;
}

export async function resolveRun(runArgument) {
  if (!runArgument) {
    throw new Error('Missing run id or run directory.');
  }
  const directPath = path.resolve(runArgument);
  const runDirectory = fs.existsSync(path.join(directPath, 'run.json'))
    ? directPath
    : path.join(evalsRoot, 'runs', runArgument);
  const manifestPath = path.join(runDirectory, 'run.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`QA run not found: ${runArgument}`);
  }
  return {
    runDirectory,
    manifestPath,
    manifest: await readJson(manifestPath),
  };
}

export function spawnDetachedNode(scriptPath, args, options) {
  const stdoutFd = fs.openSync(options.stdoutPath, 'a');
  const stderrFd = fs.openSync(options.stderrPath, 'a');
  try {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd ?? evalsRoot,
      detached: true,
      env: options.env,
      shell: false,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    });
    child.unref();
    return child.pid;
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

export async function runPlaywright(sessionName, args, options = {}) {
  const commandArgs = [`-s=${sessionName}`, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCliPath, ...commandArgs], {
      cwd: evalsRoot,
      env: {
        ...process.env,
        PWTEST_DAEMON_SESSION_DIR: playwrightDaemonDirectory,
        ...options.env,
      },
      shell: false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function requestControl(manifest, action, parameters = {}) {
  const control = manifest.control;
  if (!control?.port || !control?.token) {
    throw new Error('QA control channel is not ready for this run.');
  }
  const response = await postJson(control.port, control.token, { action, ...parameters });
  if (!response.ok) {
    throw new Error(response.error || `QA control action failed: ${action}`);
  }
  return response.result;
}

export async function waitForJson(filePath, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readJson(filePath);
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
}

export async function waitForHttp(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await getHttp(port);
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Timed out waiting for http://127.0.0.1:${port}.`);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function canListen(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function postJson(port, token, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/action',
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-length': Buffer.byteLength(body),
        'content-type': 'application/json',
      },
      timeout: 15_000,
    }, response => collectJsonResponse(response, resolve));
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('QA control request timed out.')));
    request.end(body);
  });
}

function getHttp(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 2_000 }, response => {
      response.resume();
      response.once('end', resolve);
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('HTTP probe timed out.')));
  });
}

function collectJsonResponse(response, resolve) {
  let content = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { content += chunk; });
  response.on('end', () => {
    try {
      resolve(JSON.parse(content));
    } catch {
      resolve({ ok: false, error: `Invalid QA control response (${response.statusCode}).` });
    }
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
