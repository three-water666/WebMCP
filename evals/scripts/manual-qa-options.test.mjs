import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildManualVsCodeArguments,
  createManualVsCodeSettings,
  parseManualQaArguments,
} from './manual-qa-options.mjs';

test('manual QA uses the configured default workspace', () => {
  assert.deepEqual(parseManualQaArguments([], {
    baseDirectory: path.resolve('caller'),
    defaultWorkspace: path.resolve('repository'),
  }), {
    help: false,
    workspacePath: path.resolve('repository'),
  });
});

test('manual QA resolves a selected workspace from the caller directory', () => {
  assert.deepEqual(parseManualQaArguments(['fixtures/project'], {
    baseDirectory: path.resolve('caller'),
    defaultWorkspace: path.resolve('repository'),
  }), {
    help: false,
    workspacePath: path.resolve('caller', 'fixtures/project'),
  });
});

test('manual QA handles help and rejects excess arguments', () => {
  assert.deepEqual(parseManualQaArguments(['--help'], {
    baseDirectory: path.resolve('caller'),
    defaultWorkspace: path.resolve('repository'),
  }), { help: true });
  assert.throws(
    () => parseManualQaArguments(['first', 'second'], {
      baseDirectory: path.resolve('caller'),
      defaultWorkspace: path.resolve('repository'),
    }),
    /at most one workspace folder/
  );
});

test('manual QA builds an isolated Extension Development Host launch', () => {
  assert.deepEqual(buildManualVsCodeArguments({
    extensionDevelopmentPath: 'extension',
    extensionsDirectory: 'extensions',
    userDataDirectory: 'user-data',
    workspacePath: 'workspace',
  }), [
    '--new-window',
    '--wait',
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
    '--extensions-dir=extensions',
    '--user-data-dir=user-data',
    '--extensionDevelopmentPath=extension',
    'workspace',
  ]);
});

test('manual QA keeps browser data in a dedicated isolated profile root', () => {
  assert.deepEqual(createManualVsCodeSettings('manual-browser-profile'), {
    'git.openRepositoryInParentFolders': 'never',
    'webcodeGateway.browser': 'isolated-edge',
    'webcodeGateway.isolatedBrowser.profileRoot': 'manual-browser-profile',
  });
});
