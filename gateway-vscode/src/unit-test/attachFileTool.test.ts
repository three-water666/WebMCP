import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ATTACH_FILE_MAX_BYTES, attachFileTool } from '../tools/attachFileTool';
import type { ToolExecutionContext, ToolResult } from '../tools';

suite('Attach File Tool', () => {
    test('returns a UTF-8 TXT file as an embedded workspace resource', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const relativePath = 'notes/example.txt';
            const content = Buffer.from('WebCode TXT attachment\n中文内容', 'utf8');
            await writeWorkspaceFile(workspaceRoot, relativePath, content);

            const result = await attachFileTool.execute({ path: relativePath }, createToolContext(workspaceRoot));
            const resource = requireBlobResource(result);

            assert.strictEqual(resource.mimeType, 'text/plain');
            assert.strictEqual(resource.blob, content.toString('base64'));
            assert.deepStrictEqual(resource._meta, {
                fileName: 'example.txt',
                bytes: content.byteLength
            });
        });
    });

    test('returns a PNG as an embedded workspace resource', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const relativePath = 'assets/sample image.png';
            const content = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01]);
            await writeWorkspaceFile(workspaceRoot, relativePath, content);

            const result = await attachFileTool.execute({ path: relativePath }, createToolContext(workspaceRoot));
            const resource = requireBlobResource(result);

            assert.strictEqual(resource.uri, 'workspace:///assets/sample%20image.png');
            assert.strictEqual(resource.mimeType, 'image/png');
            assert.strictEqual(resource.blob, content.toString('base64'));
            assert.deepStrictEqual(resource._meta, {
                fileName: 'sample image.png',
                bytes: content.byteLength
            });
            assert.match(result.content[0]?.text ?? '', /Prepared workspace file/);
        });
    });

    test('accepts a PDF header in the first 1024 bytes', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const content = Buffer.from(`\n%PDF-1.7\nexample`, 'ascii');
            await writeWorkspaceFile(workspaceRoot, 'docs/example.pdf', content);

            const result = await attachFileTool.execute({ path: 'docs/example.pdf' }, createToolContext(workspaceRoot));
            assert.strictEqual(requireBlobResource(result).mimeType, 'application/pdf');
        });
    });

    test('rejects unsupported file extensions', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await writeWorkspaceFile(workspaceRoot, 'archive.zip', Buffer.from('hello', 'utf8'));

            await assert.rejects(
                attachFileTool.execute({ path: 'archive.zip' }, createToolContext(workspaceRoot)),
                /supports only TXT, PNG, JPEG, WebP, GIF, and PDF/
            );
        });
    });

    test('rejects invalid UTF-8 TXT content', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await writeWorkspaceFile(workspaceRoot, 'invalid.txt', Buffer.from([0xC3, 0x28]));

            await assert.rejects(
                attachFileTool.execute({ path: 'invalid.txt' }, createToolContext(workspaceRoot)),
                /does not match the \.txt attachment type/
            );
        });
    });

    test('rejects content that does not match the file extension', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await writeWorkspaceFile(workspaceRoot, 'fake.png', Buffer.from('not a png', 'utf8'));

            await assert.rejects(
                attachFileTool.execute({ path: 'fake.png' }, createToolContext(workspaceRoot)),
                /does not match the \.png attachment type/
            );
        });
    });

    test('rejects files larger than the transport limit before reading them', async () => {
        await withTempWorkspace(async workspaceRoot => {
            const filePath = path.join(workspaceRoot, 'large.pdf');
            await fs.writeFile(filePath, '%PDF-', 'ascii');
            await fs.truncate(filePath, ATTACH_FILE_MAX_BYTES + 1);

            await assert.rejects(
                attachFileTool.execute({ path: 'large.pdf' }, createToolContext(workspaceRoot)),
                /supports files up to 20\.0 MB/
            );
        });
    });
});

type BlobResource = {
    blob: string;
    mimeType: string;
    uri: string;
    _meta?: unknown;
};

function requireBlobResource(result: ToolResult): BlobResource {
    const block = result.content.find(item => item.type === 'resource');
    assert.ok(block && isRecord(block.resource));
    const resource = block.resource;
    assert.strictEqual(typeof resource.blob, 'string');
    assert.strictEqual(typeof resource.mimeType, 'string');
    assert.strictEqual(typeof resource.uri, 'string');
    return resource as BlobResource;
}

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: Buffer): Promise<void> {
    const filePath = path.join(workspaceRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
}

async function withTempWorkspace(callback: (workspaceRoot: string) => Promise<void>): Promise<void> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'attach-file-tool-'));
    try {
        await callback(workspaceRoot);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
}

function createToolContext(workspaceRoot: string): ToolExecutionContext {
    return {
        workspaceRoot,
        outputChannel: {} as ToolExecutionContext['outputChannel'],
        skillManager: {} as ToolExecutionContext['skillManager'],
        terminalSessionManager: {} as ToolExecutionContext['terminalSessionManager'],
        skillDirectories: [],
        listTools: () => [],
        getToolDefinition: () => null
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
