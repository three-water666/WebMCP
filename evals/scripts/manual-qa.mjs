import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  buildManualVsCodeArguments,
  createManualVsCodeSettings,
  parseManualQaArguments,
} from './manual-qa-options.mjs';
import { evalsRoot, repoRoot, writeJson } from './qa-common.mjs';
import { resolveVsCodePath } from './runtime-paths.mjs';

const parsed = parseManualQaArguments(process.argv.slice(2), {
  baseDirectory: process.env.INIT_CWD?.trim() || repoRoot,
  defaultWorkspace: path.join(evalsRoot, 'fixtures', 'minimal-tool-loop'),
});

if (parsed.help) {
  printUsage();
  process.exit(0);
}

const workspacePath = parsed.workspacePath;
await requireWorkspaceDirectory(workspacePath);

const vscodePath = resolveVsCodePath();
if (!vscodePath) {
  throw new Error('qa:manual requires a locally installed VS Code executable.');
}

const sessionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-manual-vscode-'));
const userDataDirectory = path.join(sessionDirectory, 'user-data');
const extensionsDirectory = path.join(sessionDirectory, 'extensions');
const settingsDirectory = path.join(userDataDirectory, 'User');
const browserProfileRoot = path.join(evalsRoot, 'manual-browser-profiles');

await fs.mkdir(settingsDirectory, { recursive: true });
await fs.mkdir(extensionsDirectory, { recursive: true });
await writeJson(
  path.join(settingsDirectory, 'settings.json'),
  createManualVsCodeSettings(browserProfileRoot)
);

const launchArguments = buildManualVsCodeArguments({
  extensionDevelopmentPath: path.join(repoRoot, 'gateway-vscode'),
  extensionsDirectory,
  userDataDirectory,
  workspacePath,
});

console.log('Manual webcode test environment ready to launch.');
console.log(`Workspace: ${workspacePath}`);
console.log(`VS Code user data: ${userDataDirectory}`);
console.log(`Browser profiles: ${browserProfileRoot}`);
console.log('Start Gateway and choose the AI site inside the Extension Development Host.');
console.log('Close the browser and VS Code windows manually when testing is complete.');

try {
  const exitCode = await launchVsCode(vscodePath, launchArguments);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
} finally {
  await fs.rm(sessionDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  }).catch(error => {
    console.warn(`Could not remove temporary VS Code data at ${sessionDirectory}: ${error.message}`);
  });
}

async function requireWorkspaceDirectory(workspaceDirectory) {
  let stats;
  try {
    stats = await fs.stat(workspaceDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Workspace folder does not exist: ${workspaceDirectory}`);
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Workspace path is not a folder: ${workspaceDirectory}`);
  }
}

function launchVsCode(executablePath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd: workspacePath,
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}

function printUsage() {
  console.log('Usage: pnpm qa:manual [workspace-folder]');
  console.log('Defaults to evals/fixtures/minimal-tool-loop when workspace-folder is omitted.');
}
