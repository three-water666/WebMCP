import * as fs from 'fs/promises';
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { BUILTIN_CREATE_SKILLS_SKILL_FILE_PATH, resolveBuiltinSkillVirtualFile } from '../builtinSkills';
import { readFileContent, readFilePrefix, readFileTool, selectReadFileContent, selectReadFileResult } from '../tools/readFileTool';
import { READ_FILE_OUTPUT_MAX_BYTES, READ_FILE_OUTPUT_MAX_LINES } from '../tools/readFileOutputLimit';
import type { ToolExecutionContext } from '../tools';
import { SessionMetricsCollector } from '../session/sessionMetricsCollector';
import { resolveWorkspaceRelativeDirectory, resolveWorkspaceRelativePath } from '../tools/workspacePath';

suite('Read File Tool', () => {
    const content = ['alpha', 'bravo', 'charlie', 'delta'].join('\n');

    test('reads an inclusive line range with line numbers', () => {
        assert.strictEqual(
            selectReadFileContent(content, {
                start_line: 2,
                end_line: 3,
                show_line_numbers: true
            }),
            ['2: bravo', '3: charlie'].join('\n')
        );
    });

    test('numbers tail output from the original file line', () => {
        assert.strictEqual(
            selectReadFileContent(content, {
                tail: 2,
                show_line_numbers: true
            }),
            ['3: charlie', '4: delta'].join('\n')
        );
    });

    test('clamps head output to the available line count', () => {
        const result = selectReadFileResult(content, { head: 20 });

        assert.strictEqual(result.text, content);
        assert.strictEqual(result.metadata, undefined);
    });

    test('returns an empty range when start_line is past EOF', () => {
        const result = selectReadFileResult(content, { start_line: 20, end_line: 25 });

        assert.strictEqual(result.text, '');
        assert.strictEqual(result.metadata, undefined);
    });

    test('rejects mixed head and range selectors', () => {
        assert.throws(
            () => selectReadFileContent(content, { head: 2, start_line: 2, end_line: 3 }),
            /Cannot specify head or tail with start_line or end_line/
        );
    });

    test('rejects partial line ranges', () => {
        assert.throws(
            () => selectReadFileContent(content, { start_line: 2 }),
            /start_line and end_line must be specified together/
        );
    });

    test('returns full content for small files without a line selector', () => {
        const result = selectReadFileResult(content, {}, { fileBytes: Buffer.byteLength(content, 'utf8') });

        assert.strictEqual(result.text, content);
        assert.strictEqual(result.metadata, undefined);
    });

    test('truncates large line counts when no selector is provided', () => {
        const largeContent = Array.from({ length: READ_FILE_OUTPUT_MAX_LINES + 1 }, (_, index) => `line ${index + 1}`).join('\n');
        const result = selectReadFileResult(largeContent, {}, { fileBytes: Buffer.byteLength(largeContent, 'utf8') });
        const metadata = requireReadFileMetadata(result);

        assert.strictEqual(metadata.truncated, true);
        assert.strictEqual(metadata.reason, 'line_limit');
        assert.strictEqual(metadata.lineCountKnown, true);
        assert.strictEqual(metadata.lineCount, READ_FILE_OUTPUT_MAX_LINES + 1);
        assert.strictEqual(metadata.returnedLines.end, READ_FILE_OUTPUT_MAX_LINES);
        assert.ok(result.text.includes(`line ${READ_FILE_OUTPUT_MAX_LINES}`));
        assert.ok(!result.text.includes(`line ${READ_FILE_OUTPUT_MAX_LINES + 1}`));
        assert.ok(result.text.includes('Use a narrower line range with start_line/end_line, head, or tail to read more.'));
    });

    test('reports byte-limit truncation when only the prefix is read', async () => {
        await withTempFile('x'.repeat(READ_FILE_OUTPUT_MAX_BYTES + 1024), async filePath => {
            const fileStats = await fs.stat(filePath);
            const result = await readFileContent(filePath, fileStats.size, {});
            const metadata = requireReadFileMetadata(result);

            assert.strictEqual(metadata.truncated, true);
            assert.strictEqual(metadata.reason, 'byte_limit');
            assert.strictEqual(metadata.lineCountKnown, false);
            assert.strictEqual(metadata.lineCount, undefined);
        });
    });

    test('reports byte and line truncation when both output limits apply', async () => {
        const largeContent = Array.from({ length: READ_FILE_OUTPUT_MAX_LINES + 500 }, (_, index) => {
            return `line ${index + 1} ${'x'.repeat(90)}`;
        }).join('\n');

        await withTempFile(largeContent, async filePath => {
            const fileStats = await fs.stat(filePath);
            const result = await readFileContent(filePath, fileStats.size, {});
            const metadata = requireReadFileMetadata(result);

            assert.strictEqual(metadata.truncated, true);
            assert.strictEqual(metadata.reason, 'line_and_byte_limit');
            assert.strictEqual(metadata.lineCountKnown, false);
            assert.strictEqual(metadata.returnedLines.end, READ_FILE_OUTPUT_MAX_LINES);
        });
    });

    test('applies the line output limit to explicit ranges', () => {
        const largeContent = Array.from({ length: READ_FILE_OUTPUT_MAX_LINES + 1 }, (_, index) => `line ${index + 1}`).join('\n');
        const result = selectReadFileResult(largeContent, {
            start_line: 1,
            end_line: READ_FILE_OUTPUT_MAX_LINES + 1
        });
        const metadata = requireReadFileMetadata(result);

        assert.strictEqual(metadata.truncated, true);
        assert.strictEqual(metadata.reason, 'line_limit');
        assert.deepStrictEqual(metadata.returnedLines, {
            start: 1,
            end: READ_FILE_OUTPUT_MAX_LINES
        });
    });

    test('applies the byte output limit to explicit ranges', () => {
        const largeContent = `${'x'.repeat(READ_FILE_OUTPUT_MAX_BYTES + 1024)}\nsecond`;
        const result = selectReadFileResult(largeContent, {
            start_line: 1,
            end_line: 2
        });
        const metadata = requireReadFileMetadata(result);

        assert.strictEqual(metadata.truncated, true);
        assert.strictEqual(metadata.reason, 'byte_limit');
        assert.deepStrictEqual(metadata.returnedLines, {
            start: 1,
            end: 1
        });
        assert.ok(!result.text.includes('second'));
    });

    test('preserves the file tail when tail output hits the byte limit', async () => {
        const largeContent = Array.from({ length: 300 }, (_, index) => {
            return `line ${index + 1} ${'x'.repeat(900)}`;
        }).join('\n');

        await withTempFile(largeContent, async filePath => {
            const fileStats = await fs.stat(filePath);
            const result = await readFileContent(filePath, fileStats.size, {
                tail: 200,
                show_line_numbers: true
            });
            const metadata = requireReadFileMetadata(result);

            assert.strictEqual(metadata.truncated, true);
            assert.strictEqual(metadata.reason, 'byte_limit');
            assert.strictEqual(metadata.returnedLines.end, 300);
            assert.ok(metadata.returnedLines.start > 101);
            assert.ok(result.text.includes('300: line 300'));
            assert.ok(!result.text.includes('101: line 101'));
        });
    });

    test('does not truncate a capped head read that reaches exact EOF', async () => {
        const exactLimitContent = Array.from({ length: READ_FILE_OUTPUT_MAX_LINES }, (_, index) => {
            return `line ${index + 1}`;
        }).join('\n');

        await withTempFile(exactLimitContent, async filePath => {
            const fileStats = await fs.stat(filePath);
            const result = await readFileContent(filePath, fileStats.size, {
                head: READ_FILE_OUTPUT_MAX_LINES + 1
            });

            assert.strictEqual(result.text, exactLimitContent);
            assert.strictEqual(result.metadata, undefined);
        });
    });

    test('streams line ranges from large files instead of loading full content', async () => {
        const largeContent = Array.from({ length: 2000 }, (_, index) => {
            const lineNumber = index + 1;
            return `line ${lineNumber.toString().padStart(4, '0')} ${'x'.repeat(80)}`;
        }).join('\n');

        await withTempFile(largeContent, async filePath => {
            const fileStats = await fs.stat(filePath);
            const result = await readFileContent(filePath, fileStats.size, {
                start_line: 1200,
                end_line: 1202,
                show_line_numbers: true
            });

            assert.strictEqual(
                result.text,
                [
                    `1200: line 1200 ${'x'.repeat(80)}`,
                    `1201: line 1201 ${'x'.repeat(80)}`,
                    `1202: line 1202 ${'x'.repeat(80)}`
                ].join('\n')
            );
            assert.strictEqual(result.metadata, undefined);
        });
    });

    test('reads prefix until the requested byte count is filled', async () => {
        await withTempFile('abcdef', async filePath => {
            assert.strictEqual(await readFilePrefix(filePath, 5, 2), 'abcde');
        });
    });

    test('preserves utf-8 boundary when byte limit splits a character', async () => {
        await withTempFile('abcd你xyz', async filePath => {
            assert.strictEqual(await readFilePrefix(filePath, 6), 'abcd');
        });
    });

    test('keeps utf-8 character when byte limit ends on a boundary', async () => {
        await withTempFile('abcd你xyz', async filePath => {
            assert.strictEqual(await readFilePrefix(filePath, 7), 'abcd你');
        });
    });

    test('keeps invalid continuation bytes at the prefix boundary', async () => {
        await withTempFileBytes(Buffer.from([0x80, 0x80, 0x80, 0x80]), async filePath => {
            assert.strictEqual(await readFilePrefix(filePath, 4), '\uFFFD\uFFFD\uFFFD\uFFFD');
        });
    });

    test('keeps invalid lead bytes at the prefix boundary', async () => {
        await withTempFileBytes(Buffer.from([0x61, 0xFF, 0x80, 0x80]), async filePath => {
            assert.strictEqual(await readFilePrefix(filePath, 4), 'a\uFFFD\uFFFD\uFFFD');
        });
    });

    test('keeps invalid lead-like bytes at the prefix boundary', async () => {
        await withTempFileBytes(Buffer.from([0x61, 0xC0]), async filePath => {
            assert.strictEqual(await readFilePrefix(filePath, 2), 'a\uFFFD');
        });
    });

    test('resolves workspace-relative posix paths', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-file-tool-workspace-'));
        const skillFilePath = path.join(tempDir, '.codex', 'skills', 'release-package', 'SKILL.md');
        try {
            await fs.mkdir(path.dirname(skillFilePath), { recursive: true });
            await fs.writeFile(skillFilePath, '# release-package\n', 'utf8');

            assert.strictEqual(
                (await resolveWorkspaceRelativePath(tempDir, '.codex/skills/release-package/SKILL.md')).absolutePath,
                await fs.realpath(skillFilePath)
            );
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    test('reads built-in skill virtual paths without a workspace root', async () => {
        const result = await readFileTool.execute({
            path: BUILTIN_CREATE_SKILLS_SKILL_FILE_PATH,
            head: 4
        }, createReadFileToolContext(null));
        const text = result.content[0]?.text;

        assert.strictEqual(result.isError, undefined);
        assert.ok(text?.includes('name: create-skills'));
    });

    test('does not resolve built-in skills for workspace paths', async () => {
        const tempDir = await createTempDir();
        try {
            await fs.writeFile(path.join(tempDir, 'sample.txt'), 'workspace file\n', 'utf8');

            const result = await readFileTool.execute({
                path: 'sample.txt'
            }, createReadFileToolContext(tempDir, {
                resolveBuiltinSkillVirtualFile() {
                    throw new Error('Unexpected built-in skill resolution.');
                }
            }));

            assert.strictEqual(result.content[0]?.text, 'workspace file\n');
        } finally {
            await removeTempDir(tempDir);
        }
    });

    test('resolves workspace-relative command directories', async () => {
        const tempDir = await createTempDir();
        try {
            const commandDir = path.join(tempDir, 'packages', 'sample');
            await fs.mkdir(commandDir, { recursive: true });

            const result = await resolveWorkspaceRelativeDirectory(tempDir, 'packages/sample');

            assert.strictEqual(result.absolutePath, await fs.realpath(commandDir));
            assert.strictEqual(result.relativePath, 'packages/sample');
        } finally {
            await removeTempDir(tempDir);
        }
    });

    test('rejects absolute command directories', async () => {
        const tempDir = await createTempDir();
        try {
            const commandDir = path.join(tempDir, 'packages', 'sample');
            await fs.mkdir(commandDir, { recursive: true });
            const absoluteCommandDir = commandDir.replace(/\\/g, '/');

            await assert.rejects(
                resolveWorkspaceRelativeDirectory(tempDir, absoluteCommandDir),
                /workspace-relative; absolute paths are not allowed/
            );
        } finally {
            await removeTempDir(tempDir);
        }
    });

    test('rejects backslashes in command directories', async () => {
        const tempDir = await createTempDir();
        try {
            await assert.rejects(
                resolveWorkspaceRelativeDirectory(tempDir, 'packages\\sample'),
                /backslashes are not allowed/
            );
        } finally {
            await removeTempDir(tempDir);
        }
    });

    test('rejects command directory traversal without leaking the workspace path', async () => {
        const tempDir = await createTempDir();
        try {
            try {
                await resolveWorkspaceRelativeDirectory(tempDir, '../outside');
                assert.fail('Expected path traversal to be rejected.');
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);

                assert.match(message, /path must stay inside the VS Code workspace/);
                assert.ok(!message.includes(tempDir));
            }
        } finally {
            await removeTempDir(tempDir);
        }
    });
});

async function withTempFile<T>(content: string, callback: (filePath: string) => Promise<T>): Promise<T> {
    return withTempFileBytes(Buffer.from(content, 'utf8'), callback);
}

async function withTempFileBytes<T>(content: Buffer, callback: (filePath: string) => Promise<T>): Promise<T> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-file-tool-'));
    const filePath = path.join(tempDir, 'sample.txt');
    try {
        await fs.writeFile(filePath, content);
        return await callback(filePath);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function createTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'workspace-dir-'));
}

async function removeTempDir(tempDir: string): Promise<void> {
    await fs.rm(tempDir, { recursive: true, force: true });
}

type TestReadFileMetadata = {
    truncated: true;
    reason: string;
    lineCountKnown: boolean;
    lineCount?: number;
    returnedLines: {
        start: number;
        end: number;
    };
};

function requireReadFileMetadata(result: { metadata?: TestReadFileMetadata }): TestReadFileMetadata {
    assert.ok(result.metadata);
    return result.metadata;
}

function createReadFileToolContext(
    workspaceRoot: string | null,
    skillManager: Partial<ToolExecutionContext['skillManager']> = {}
): ToolExecutionContext {
    return {
        metricsCollector: new SessionMetricsCollector(),
        workspaceRoot,
        outputChannel: {
            appendLine(value: string) {
                void value;
            }
        } as unknown as ToolExecutionContext['outputChannel'],
        skillManager: {
            resolveBuiltinSkillVirtualFile(requestedPath: unknown) {
                return resolveBuiltinSkillVirtualFile(getExtensionPath(), requestedPath);
            },
            ...skillManager
        } as unknown as ToolExecutionContext['skillManager'],
        terminalSessionManager: {} as ToolExecutionContext['terminalSessionManager'],
        skillDirectories: [],
        listTools: () => [],
        getToolDefinition: () => null
    };
}

function getExtensionPath(): string {
    return path.resolve(__dirname, '..', '..');
}
