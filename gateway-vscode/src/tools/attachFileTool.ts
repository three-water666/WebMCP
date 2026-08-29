import * as fs from 'fs/promises';
import * as path from 'path';
import { isUtf8 } from 'buffer';
import type { LocalTool, ToolResult } from './types';
import { WORKSPACE_FILE_PATH_DESCRIPTION, resolveWorkspaceRelativePath } from './workspacePath';

export const ATTACH_FILE_MAX_BYTES = 20 * 1024 * 1024;

type SupportedAttachment = {
    extensions: readonly string[];
    mimeType: string;
    matches: (content: Buffer) => boolean;
};

const SUPPORTED_ATTACHMENTS: readonly SupportedAttachment[] = [
    {
        extensions: ['.txt'],
        mimeType: 'text/plain',
        matches: content => isUtf8(content)
    },
    {
        extensions: ['.png'],
        mimeType: 'image/png',
        matches: content => startsWithBytes(content, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    },
    {
        extensions: ['.jpg', '.jpeg'],
        mimeType: 'image/jpeg',
        matches: content => startsWithBytes(content, [0xFF, 0xD8, 0xFF])
    },
    {
        extensions: ['.webp'],
        mimeType: 'image/webp',
        matches: content => content.length >= 12 &&
            content.subarray(0, 4).toString('ascii') === 'RIFF' &&
            content.subarray(8, 12).toString('ascii') === 'WEBP'
    },
    {
        extensions: ['.gif'],
        mimeType: 'image/gif',
        matches: content => {
            const signature = content.subarray(0, 6).toString('ascii');
            return signature === 'GIF87a' || signature === 'GIF89a';
        }
    },
    {
        extensions: ['.pdf'],
        mimeType: 'application/pdf',
        matches: content => content.subarray(0, Math.min(content.length, 1024)).includes(Buffer.from('%PDF-', 'ascii'))
    }
];

export const attachFileTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'attach_file',
        description: 'Attach a UTF-8 TXT, image, or PDF file from the current VS Code workspace to the AI conversation. ' +
            'Supports TXT, PNG, JPEG, WebP, GIF, and PDF files up to 20 MB. ' +
            'Use read_file instead when only the text contents need inspection.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: WORKSPACE_FILE_PATH_DESCRIPTION }
            },
            required: ['path']
        },
        annotations: { readOnlyHint: true }
    },
    async execute(args, context) {
        const resolved = await resolveWorkspaceRelativePath(context.workspaceRoot, args.path);
        const stats = await fs.stat(resolved.absolutePath);
        if (!stats.isFile()) {
            throw new Error(`path must point to a file: ${resolved.relativePath}`);
        }
        if (stats.size === 0) {
            throw new Error('attach_file cannot attach an empty file.');
        }
        if (stats.size > ATTACH_FILE_MAX_BYTES) {
            throw new Error(`attach_file supports files up to ${formatBytes(ATTACH_FILE_MAX_BYTES)}.`);
        }

        const content = await fs.readFile(resolved.absolutePath);
        if (content.byteLength > ATTACH_FILE_MAX_BYTES) {
            throw new Error(`attach_file supports files up to ${formatBytes(ATTACH_FILE_MAX_BYTES)}.`);
        }

        const attachment = resolveSupportedAttachment(resolved.relativePath, content);
        const fileName = path.posix.basename(resolved.relativePath);
        return createAttachmentResult({
            base64: content.toString('base64'),
            bytes: content.byteLength,
            fileName,
            mimeType: attachment.mimeType,
            relativePath: resolved.relativePath
        });
    }
};

function resolveSupportedAttachment(relativePath: string, content: Buffer): SupportedAttachment {
    const extension = path.posix.extname(relativePath).toLowerCase();
    const attachment = SUPPORTED_ATTACHMENTS.find(candidate => candidate.extensions.includes(extension));
    if (!attachment) {
        throw new Error('attach_file supports only TXT, PNG, JPEG, WebP, GIF, and PDF files.');
    }
    if (!attachment.matches(content)) {
        throw new Error(`File content does not match the ${extension || 'requested'} attachment type.`);
    }
    return attachment;
}

function createAttachmentResult(details: {
    base64: string;
    bytes: number;
    fileName: string;
    mimeType: string;
    relativePath: string;
}): ToolResult {
    return {
        content: [
            {
                type: 'text',
                text: `Prepared workspace file "${details.relativePath}" (${details.mimeType}, ${formatBytes(details.bytes)}) ` +
                    'for browser attachment delivery. Inspect the delivered attachment before continuing.'
            },
            {
                type: 'resource',
                resource: {
                    uri: createWorkspaceResourceUri(details.relativePath),
                    mimeType: details.mimeType,
                    blob: details.base64,
                    _meta: {
                        fileName: details.fileName,
                        bytes: details.bytes
                    }
                }
            }
        ]
    };
}

function createWorkspaceResourceUri(relativePath: string): string {
    const encodedPath = relativePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `workspace:///${encodedPath}`;
}

function startsWithBytes(content: Buffer, signature: readonly number[]): boolean {
    return content.length >= signature.length && signature.every((value, index) => content[index] === value);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
