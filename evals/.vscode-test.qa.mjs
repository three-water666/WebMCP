import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const extensionDevelopmentPath = fileURLToPath(new URL('../gateway-vscode', import.meta.url));
const workspaceFolder = requireEnvironmentPath('WEBCODE_EVAL_WORKSPACE');
const runDirectory = requireEnvironmentPath('WEBCODE_EVAL_RUN_DIR');
const vscodeExecutablePath = process.env.WEBCODE_EVAL_VSCODE_PATH?.trim();
const debuggingPort = requireEnvironmentPath('WEBCODE_QA_VSCODE_CDP_PORT');

export default defineConfig({
  files: 'out/extension-test/interactiveQa.test.js',
  version: process.env.VSCODE_TEST_VERSION?.trim() || '1.106.1',
  extensionDevelopmentPath,
  workspaceFolder,
  launchArgs: [
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
    `--extensions-dir=${path.join(runDirectory, 'vscode-extensions')}`,
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${path.join(runDirectory, 'vscode-user-data')}`,
  ],
  env: {
    WEBCODE_EVAL_MODE: '1',
    WEBCODE_EVAL_RUN_DIR: process.env.WEBCODE_EVAL_RUN_DIR,
    WEBCODE_EVAL_TRACE_PATH: process.env.WEBCODE_EVAL_TRACE_PATH,
    WEBCODE_QA_CONTROL_TOKEN: process.env.WEBCODE_QA_CONTROL_TOKEN,
    WEBCODE_QA_GATEWAY_CONFIG_PATH: process.env.WEBCODE_QA_GATEWAY_CONFIG_PATH,
    WEBCODE_QA_GATEWAY_PORT: process.env.WEBCODE_QA_GATEWAY_PORT,
  },
  ...(vscodeExecutablePath
    ? { useInstallation: { fromPath: vscodeExecutablePath } }
    : {}),
  mocha: {
    timeout: 24 * 60 * 60 * 1000,
  },
});

function requireEnvironmentPath(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Run through qa:start.`);
  }
  return value;
}
