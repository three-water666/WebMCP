import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';

const extensionDevelopmentPath = fileURLToPath(new URL('../gateway-vscode', import.meta.url));
const workspaceFolder = requireEnvironmentPath('WEBCODE_EVAL_WORKSPACE');
const vscodeExecutablePath = process.env.WEBCODE_EVAL_VSCODE_PATH?.trim();

export default defineConfig({
  files: 'out/extension-test/**/*.test.js',
  version: process.env.VSCODE_TEST_VERSION?.trim() || '1.106.1',
  extensionDevelopmentPath,
  workspaceFolder,
  launchArgs: [
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
  ],
  env: {
    WEBCODE_EVAL_MODE: '1',
    WEBCODE_EVAL_BROWSER_PATH: process.env.WEBCODE_EVAL_BROWSER_PATH,
    WEBCODE_EVAL_RUN_DIR: process.env.WEBCODE_EVAL_RUN_DIR,
    WEBCODE_EVAL_SCENARIO_PATH: process.env.WEBCODE_EVAL_SCENARIO_PATH,
    WEBCODE_EVAL_TRACE_PATH: process.env.WEBCODE_EVAL_TRACE_PATH,
  },
  ...(vscodeExecutablePath
    ? { useInstallation: { fromPath: vscodeExecutablePath } }
    : {}),
  mocha: {
    timeout: 120_000,
  },
});

function requireEnvironmentPath(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Run the E2E through scripts/run-minimal-e2e.mjs.`);
  }
  return value;
}
