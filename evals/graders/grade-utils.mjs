import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function check(id, points, passed, message) {
  return { id, points, passed: Boolean(passed), message };
}

export function gradeResult(checks) {
  const maxScore = checks.reduce((sum, item) => sum + item.points, 0);
  const earned = checks.reduce((sum, item) => sum + (item.passed ? item.points : 0), 0);
  const score = maxScore === 0 ? 0 : Math.round((earned / maxScore) * 100);
  return {
    passed: checks.every(item => item.passed),
    score,
    checks,
  };
}

export async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function readText(filePath) {
  return fs.readFile(filePath, 'utf8').catch(() => '');
}

export async function importWorkspaceModule(workspacePath, relativePath) {
  const moduleUrl = pathToFileURL(path.join(workspacePath, relativePath));
  moduleUrl.searchParams.set('evalRun', `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

export async function capture(callback) {
  try {
    return { ok: true, value: await callback() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runNodeTests(workspacePath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test'], {
      cwd: workspacePath,
      env: { ...process.env, NO_COLOR: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    child.once('error', error => resolve({ exitCode: 1, output: error.message }));
    child.once('exit', code => resolve({ exitCode: code ?? 1, output }));
  });
}

export async function withWorkspaceCopy(workspacePath, callback) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-eval-grader-'));
  const copyPath = path.join(temporaryRoot, 'workspace');
  try {
    await fs.cp(workspacePath, copyPath, { recursive: true });
    return await callback(copyPath);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
