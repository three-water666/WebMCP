import * as assert from 'assert';
import * as path from 'path';

import { resolveAllowedBridgeTarget, resolveBridgeSite } from '../gateway/bridgeRoute';
import { resolveInsideWorkspace, resolveLocalPathArguments } from '../gateway/pathArguments';
import type { RemoteToolRoute } from '../gateway/types';
import type { ResolvedAiSiteConfig } from '../platforms';

suite('Gateway path and bridge guards', () => {
    test('resolves relative remote tool paths inside the workspace', () => {
        const workspaceRoot = path.resolve('workspace-root');
        const args: Record<string, unknown> = {
            path: 'src/index.ts',
            paths: ['README.md', 123]
        };

        resolveLocalPathArguments(createRoute('read_file'), args, workspaceRoot);

        assert.strictEqual(args.path, path.resolve(workspaceRoot, 'src/index.ts'));
        assert.deepStrictEqual(args.paths, [path.resolve(workspaceRoot, 'README.md'), 123]);
    });

    test('allows absolute paths that stay inside the workspace', () => {
        const workspaceRoot = path.resolve('workspace-root');
        const insidePath = path.resolve(workspaceRoot, 'src/index.ts');

        assert.strictEqual(resolveInsideWorkspace(workspaceRoot, insidePath), insidePath);
    });

    test('rejects relative traversal outside the workspace', () => {
        const workspaceRoot = path.resolve('workspace-root');

        assert.throws(
            () => resolveInsideWorkspace(workspaceRoot, '../outside.txt'),
            /Path escapes workspace/
        );
    });

    test('rejects absolute paths outside the workspace', () => {
        const workspaceRoot = path.resolve('workspace-root');
        const outsidePath = path.resolve(path.dirname(workspaceRoot), 'outside.txt');

        assert.throws(
            () => resolveInsideWorkspace(workspaceRoot, outsidePath),
            /Path escapes workspace/
        );
    });

    test('allows bridge targets whose origin is configured', () => {
        assert.strictEqual(
            resolveAllowedBridgeTarget('https://chatgpt.com/g/example', createSite('chatgpt', 'https://chatgpt.com')),
            'https://chatgpt.com/g/example'
        );
    });

    test('rejects bridge targets outside the selected site', () => {
        assert.strictEqual(
            resolveAllowedBridgeTarget('https://example.test/', createSite('chatgpt', 'https://chatgpt.com')),
            null
        );
    });

    test('rejects non-http bridge targets', () => {
        assert.strictEqual(
            resolveAllowedBridgeTarget('javascript:alert(1)', createSite('chatgpt', 'https://chatgpt.com')),
            null
        );
    });

    test('resolves bridge sites by explicit site id', () => {
        const sites = [
            createSite('chatgpt', 'https://chatgpt.com'),
            createSite('gemini', 'https://gemini.google.com')
        ];

        assert.strictEqual(resolveBridgeSite('gemini', sites)?.id, 'gemini');
        assert.strictEqual(resolveBridgeSite('missing', sites), null);
    });
});

function createRoute(toolName: string): RemoteToolRoute {
    return {
        client: {} as RemoteToolRoute['client'],
        definition: {} as RemoteToolRoute['definition'],
        serverId: 'filesystem',
        toolName
    };
}

function createSite(id: string, address: string): ResolvedAiSiteConfig {
    return {
        id,
        name: id,
        address,
        toolProtocol: 'json',
        selectors: {
            messageBlocks: '.message',
            codeBlocks: 'pre code',
            inputArea: 'textarea',
            sendButton: 'button.send',
            stopButton: 'button.stop',
        }
    };
}
