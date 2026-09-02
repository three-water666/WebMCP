import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { ToolExecutionContext } from '../tools/types';
import { SessionMetricsCollector } from '../session/sessionMetricsCollector';
import { writeFileTool } from '../tools/writeFileTool';

suite('Write File Tool', () => {
    test('describes automatic parent directory creation', () => {
        assert.match(
            writeFileTool.definition.description,
            /Parent directories are created automatically/
        );
    });

    test('creates missing parent directories before writing a file', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const relativePath = 'new-folder/nested/deep/sample.txt';
            const targetPath = path.join(workspaceRoot, 'new-folder', 'nested', 'deep', 'sample.txt');

            await writeFileTool.execute(
                {
                    path: relativePath,
                    content: 'hello\n'
                },
                { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
            );

            assert.strictEqual(await fs.readFile(targetPath, 'utf8'), 'hello\n');
        });
    });

    test('creates missing child directories under an existing parent', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await fs.mkdir(path.join(workspaceRoot, 'existing-dir'));
            const relativePath = 'existing-dir/new-subdir/sample.txt';

            await writeFileTool.execute(
                {
                    path: relativePath,
                    content: 'partial\n'
                },
                { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
            );

            assert.strictEqual(
                await fs.readFile(path.join(workspaceRoot, 'existing-dir', 'new-subdir', 'sample.txt'), 'utf8'),
                'partial\n'
            );
        });
    });

    test('overwrites an existing file', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const relativePath = 'sample.txt';
            const targetPath = path.join(workspaceRoot, relativePath);
            await fs.writeFile(targetPath, 'old\n', 'utf8');

            await writeFileTool.execute(
                {
                    path: relativePath,
                    content: 'new\n'
                },
                { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
            );

            assert.strictEqual(await fs.readFile(targetPath, 'utf8'), 'new\n');
        });
    });

    test('rejects creating parent directories outside the workspace through traversal', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const result = writeFileTool.execute(
                {
                    path: '../outside/sample.txt',
                    content: 'nope\n'
                },
                { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
            );

            await assert.rejects(
                result,
                /path must stay inside/
            );
        });
    });

    test('rejects absolute paths outside the workspace', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-file-tool-absolute-outside-'));
            const outsideFile = path.join(outsideDir, 'sample.txt');
            const outsideFileArg = outsideFile.replace(/\\/g, '/');
            try {
                const result = writeFileTool.execute(
                    {
                        path: outsideFileArg,
                        content: 'nope\n'
                    },
                    { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
                );

                await assert.rejects(
                    result,
                    /workspace-relative; absolute paths are not allowed/
                );
                await assert.rejects(
                    fs.stat(outsideFile),
                    /ENOENT/
                );
            } finally {
                await fs.rm(outsideDir, { recursive: true, force: true });
            }
        });
    });

    test('rejects backslashes in file paths', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const result = writeFileTool.execute(
                {
                    path: 'nested\\sample.txt',
                    content: 'nope\n'
                },
                { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
            );

            await assert.rejects(
                result,
                /backslashes are not allowed/
            );
        });
    });

    test('rejects creating parent directories through a linked outside ancestor', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-file-tool-outside-'));
            try {
                const linkPath = path.join(workspaceRoot, 'outside-link');
                const createdLink = await tryCreateDirectoryLink(outsideDir, linkPath);
                if (!createdLink) {
                    return;
                }

                const result = writeFileTool.execute(
                    {
                        path: 'outside-link/nested/sample.txt',
                        content: 'nope\n'
                    },
                    { workspaceRoot, metricsCollector: new SessionMetricsCollector() } as ToolExecutionContext
                );

                await assert.rejects(
                    result,
                    /path must stay inside/
                );
                await assert.rejects(
                    fs.stat(path.join(outsideDir, 'nested')),
                    /ENOENT/
                );
            } finally {
                await fs.rm(outsideDir, { recursive: true, force: true });
            }
        });
    });
});

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-file-tool-workspace-'));
    try {
        return await callback(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function tryCreateDirectoryLink(targetPath: string, linkPath: string): Promise<boolean> {
    try {
        await fs.symlink(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        return true;
    } catch (error: unknown) {
        if (hasErrorCode(error, 'EACCES') || hasErrorCode(error, 'EPERM')) {
            return false;
        }
        throw error;
    }
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === code;
}
