import * as assert from 'assert';
import * as path from 'path';
import type * as vscode from 'vscode';

import { resolveCommandAllowedRoots } from '../extension/commandAllowedRoots';

suite('Command allowed roots', () => {
  test('accepts existing absolute roots and ignores relative roots', () => {
    const workspaceRoot = process.cwd();
    const outsideRoot = path.dirname(workspaceRoot);
    const messages: string[] = [];
    const outputChannel = {
      appendLine(message: string) {
        messages.push(message);
      }
    } as unknown as vscode.OutputChannel;

    const roots = resolveCommandAllowedRoots(
      [outsideRoot, '.', '${workspaceFolder}'],
      workspaceRoot,
      outputChannel
    );

    assert.deepStrictEqual(roots, [path.resolve(outsideRoot)]);
    assert.ok(messages.some(message => message.includes('non-absolute')));
  });
});
