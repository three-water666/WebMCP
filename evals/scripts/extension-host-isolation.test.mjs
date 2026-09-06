import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const configNames = ['.vscode-test.qa.mjs', '.vscode-test.mjs', '.vscode-test.deepseek.mjs'];
const testRoot = path.join(os.tmpdir(), 'webcode-host-isolation-test');

for (const configName of configNames) {
  test(`${configName} overrides inherited bridge roots with a separate directory for each run`, () => {
    const roots = ['run-a', 'run-b'].map(runName => {
      const runDirectory = path.join(testRoot, runName);
      const result = readHostConfig(configName, runDirectory);
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const config = JSON.parse(result.stdout);
      const installRoot = config.env.WEBCODE_BROWSER_EXTENSION_ROOT;
      assert.equal(installRoot, path.join(runDirectory, 'browser-extensions'));
      assert.notEqual(installRoot, path.join(runDirectory, 'browser-extension'));
      return installRoot;
    });
    assert.notEqual(roots[0], roots[1]);
  });

  test(`${configName} rejects a missing run directory instead of using the shared installation`, () => {
    const result = readHostConfig(configName, '');
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing required environment variable WEBCODE_EVAL_RUN_DIR/);
  });
}

function readHostConfig(configName, runDirectory) {
  const configUrl = new URL(`../${configName}`, import.meta.url);
  return spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    'const { default: config } = await import(process.argv[1]); process.stdout.write(JSON.stringify(config));',
    configUrl.href,
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      WEBCODE_EVAL_WORKSPACE: path.join(testRoot, 'workspace'),
      WEBCODE_EVAL_RUN_DIR: runDirectory,
      WEBCODE_EVAL_VSCODE_PATH: '',
      WEBCODE_QA_VSCODE_CDP_PORT: '9222',
      WEBCODE_BROWSER_EXTENSION_ROOT: path.join(testRoot, 'shared-installation'),
    },
  });
}
