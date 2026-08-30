import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { resolveBrowserPath, resolveVsCodePath } from './runtime-paths.mjs';

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-runtime-paths-'));
const browserPath = path.join(temporaryDirectory, 'browser.exe');
const vscodePath = path.join(temporaryDirectory, 'Code.exe');
const pathVsCodeRoot = path.join(temporaryDirectory, 'path-vscode');
const pathVsCodeBin = path.join(pathVsCodeRoot, 'bin');
const pathVsCodeExecutable = process.platform === 'win32'
  ? path.join(pathVsCodeRoot, 'Code.exe')
  : path.join(pathVsCodeBin, 'code');
const pathVsCodeLauncher = process.platform === 'win32'
  ? path.join(pathVsCodeBin, 'code.cmd')
  : pathVsCodeExecutable;
const originalBrowserPath = process.env.WEBCODE_EVAL_BROWSER_PATH;
const originalVsCodePath = process.env.WEBCODE_EVAL_VSCODE_PATH;
const originalPath = process.env.PATH;

await fs.mkdir(pathVsCodeBin, { recursive: true });
await Promise.all([
  fs.writeFile(browserPath, ''),
  fs.writeFile(vscodePath, ''),
  fs.writeFile(pathVsCodeExecutable, ''),
  fs.writeFile(pathVsCodeLauncher, ''),
]);

after(async () => {
  restoreEnvironment('WEBCODE_EVAL_BROWSER_PATH', originalBrowserPath);
  restoreEnvironment('WEBCODE_EVAL_VSCODE_PATH', originalVsCodePath);
  restoreEnvironment('PATH', originalPath);
  await fs.rm(temporaryDirectory, { force: true, recursive: true });
});

test('runtime paths use explicitly configured local executables', () => {
  process.env.WEBCODE_EVAL_BROWSER_PATH = browserPath;
  process.env.WEBCODE_EVAL_VSCODE_PATH = vscodePath;

  assert.equal(resolveBrowserPath(), browserPath);
  assert.equal(resolveVsCodePath(), vscodePath);
});

test('an invalid browser path reports how to select a local executable', () => {
  process.env.WEBCODE_EVAL_BROWSER_PATH = path.join(temporaryDirectory, 'missing-browser.exe');

  assert.throws(
    () => resolveBrowserPath(),
    /Set WEBCODE_EVAL_BROWSER_PATH to the full path of an installed browser executable/
  );
});

test('an invalid VS Code path fails instead of silently downloading', () => {
  process.env.WEBCODE_EVAL_VSCODE_PATH = path.join(temporaryDirectory, 'missing-code.exe');

  assert.throws(
    () => resolveVsCodePath(),
    /Set WEBCODE_EVAL_VSCODE_PATH to the full path of an installed VS Code executable/
  );
});

test('the VS Code test runtime is downloaded only when explicitly requested', () => {
  process.env.WEBCODE_EVAL_VSCODE_PATH = 'download';

  assert.equal(resolveVsCodePath(), undefined);
});

test('runtime paths discover a custom VS Code installation through PATH', () => {
  delete process.env.WEBCODE_EVAL_VSCODE_PATH;
  process.env.PATH = pathVsCodeBin;

  assert.equal(resolveVsCodePath(), pathVsCodeExecutable);
});

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
