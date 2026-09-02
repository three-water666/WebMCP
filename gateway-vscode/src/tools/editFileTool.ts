import * as fs from 'fs/promises';
import type { LocalTool } from './types';
import { textResult } from './result';
import {
    atomicWriteFile,
    createUnifiedDiff,
    normalizeLineEndings
} from './filesystemUtils';
import { WORKSPACE_FILE_PATH_DESCRIPTION, resolveWorkspaceRelativePath } from './workspacePath';

type FileEdit = {
    oldText: string;
    newText: string;
    replaceAll?: boolean;
};

type PatchLine = {
    type: 'context' | 'remove' | 'add';
    text: string;
};

type PatchHunk = {
    oldStart: number;
    oldCount: number;
    newCount: number;
    lines: PatchLine[];
};

type ParsedHunk = {
    hunk: PatchHunk;
    nextIndex: number;
};

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MISSING_HUNK_ERROR_MESSAGE = [
    'Patch must contain at least one unified diff hunk starting with @@.',
    'Use edits for exact text replacements, or provide a standard unified diff hunk such as',
    '@@ -1,2 +1,2 @@ with context, removed (-), and added (+) lines.'
].join(' ');

export const editFileTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'edit_file',
        description: 'Edit a UTF-8 text file inside the workspace. Use either exact text replacements or a unified diff patch. ' +
            'If prior read_file output included line numbers such as "12: code", do not include those line number prefixes in edits or patches.',
        inputSchema: {
            oneOf: [
                {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: WORKSPACE_FILE_PATH_DESCRIPTION },
                        edits: {
                            type: 'array',
                            minItems: 1,
                            items: {
                                type: 'object',
                                properties: {
                                    oldText: {
                                        type: 'string',
                                        minLength: 1,
                                        description: 'Text to replace. Must match exactly and must not include read_file line number prefixes.'
                                    },
                                    newText: {
                                        type: 'string',
                                        description: 'Replacement text. Do not include read_file line number prefixes as file content.'
                                    },
                                    replaceAll: { type: 'boolean', description: 'If true, replace every occurrence of oldText. Default: false.' }
                                },
                                required: ['oldText', 'newText']
                            },
                            description: 'Sequential exact replacement operations.'
                        },
                        dryRun: { type: 'boolean', description: 'If true, return the diff without writing the file.', default: false }
                    },
                    required: ['path', 'edits']
                },
                {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: WORKSPACE_FILE_PATH_DESCRIPTION },
                        patch: {
                            type: 'string',
                            minLength: 1,
                            description: 'Unified diff patch for this file. Include @@ hunks with context, removed (-), and added (+) lines. ' +
                                'Do not include read_file line number prefixes as patch content.'
                        },
                        dryRun: { type: 'boolean', description: 'If true, return the diff without writing the file.', default: false }
                    },
                    required: ['path', 'patch']
                }
            ]
        },
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    },
    async execute(args, context) {
        const filePath = (await resolveWorkspaceRelativePath(context.workspaceRoot, args.path)).absolutePath;
        const dryRun = args.dryRun === true;
        const rawContent = await fs.readFile(filePath, 'utf8');
        const usesCRLF = rawContent.includes('\r\n');
        const originalContent = normalizeLineEndings(rawContent);
        const modifiedContent = typeof args.patch === 'string'
            ? applyUnifiedPatch(originalContent, args.patch)
            : applyExactEdits(originalContent, args.edits as FileEdit[]);

        const diff = createUnifiedDiff(originalContent, modifiedContent, String(args.path));
        if (!dryRun && modifiedContent !== originalContent) {
            const contentToWrite = usesCRLF ? modifiedContent.replace(/\n/g, '\r\n') : modifiedContent;
            await atomicWriteFile(filePath, contentToWrite);
            context.checkpointState?.recordChangedFile(String(args.path));
        }

        return textResult(diff);
    }
};

function applyExactEdits(originalContent: string, edits: FileEdit[]): string {
    let modifiedContent = originalContent;

    for (const edit of edits) {
        const oldText = normalizeLineEndings(edit.oldText);
        const newText = normalizeLineEndings(edit.newText);
        const matches = countOccurrences(modifiedContent, oldText);

        if (matches === 0) {
            throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
        }

        if (edit.replaceAll === true) {
            modifiedContent = modifiedContent.split(oldText).join(newText);
            continue;
        }

        if (matches > 1) {
            throw new Error(`Found ${matches} matches for edit oldText. Make oldText more specific or set replaceAll to true.`);
        }

        modifiedContent = replaceFirstLiteral(modifiedContent, oldText, newText);
    }

    return modifiedContent;
}

function replaceFirstLiteral(content: string, searchText: string, replacementText: string): string {
    const index = content.indexOf(searchText);
    if (index < 0) {
        return content;
    }

    return content.slice(0, index) + replacementText + content.slice(index + searchText.length);
}

function countOccurrences(content: string, searchText: string): number {
    let count = 0;
    let index = content.indexOf(searchText);
    while (index !== -1) {
        count++;
        index = content.indexOf(searchText, index + searchText.length);
    }
    return count;
}

function applyUnifiedPatch(originalContent: string, patch: string): string {
    const hunks = parseUnifiedPatch(patch);
    const hadFinalNewline = originalContent.endsWith('\n');
    const lines = splitContentLines(originalContent);
    let offset = 0;

    for (const hunk of hunks) {
        const oldLines = hunk.lines
            .filter((line) => line.type !== 'add')
            .map((line) => line.text);
        const newLines = hunk.lines
            .filter((line) => line.type !== 'remove')
            .map((line) => line.text);

        if (oldLines.length !== hunk.oldCount) {
            throw new Error(`Patch hunk old line count mismatch at original line ${hunk.oldStart}.`);
        }
        if (newLines.length !== hunk.newCount) {
            throw new Error(`Patch hunk new line count mismatch at original line ${hunk.oldStart}.`);
        }

        const preferredIndex = oldLines.length === 0
            ? Math.max(0, hunk.oldStart + offset)
            : Math.max(0, hunk.oldStart - 1 + offset);
        const applyIndex = findHunkLocation(lines, oldLines, preferredIndex, hunk.oldStart);
        lines.splice(applyIndex, oldLines.length, ...newLines);
        offset += newLines.length - oldLines.length;
    }

    return joinContentLines(lines, hadFinalNewline);
}

function parseUnifiedPatch(patch: string): PatchHunk[] {
    const lines = stripPatchFence(normalizeLineEndings(patch)).split('\n');
    const hunks: PatchHunk[] = [];
    let index = 0;

    while (index < lines.length) {
        const parsedHunk = parseHunkAt(lines, index);
        if (!parsedHunk) {
            index++;
            continue;
        }

        hunks.push(parsedHunk.hunk);
        index = parsedHunk.nextIndex;
    }

    if (hunks.length === 0) {
        throw new Error(MISSING_HUNK_ERROR_MESSAGE);
    }

    return hunks;
}

function parseHunkAt(lines: string[], index: number): ParsedHunk | null {
    const headerMatch = lines[index].match(HUNK_HEADER_PATTERN);
    if (!headerMatch) {
        return null;
    }

    const hunk = createPatchHunk(headerMatch);
    let nextIndex = index + 1;
    while (nextIndex < lines.length && !HUNK_HEADER_PATTERN.test(lines[nextIndex])) {
        appendPatchHunkLine(hunk, lines[nextIndex]);
        nextIndex++;
    }

    return { hunk, nextIndex };
}

function createPatchHunk(headerMatch: RegExpMatchArray): PatchHunk {
    return {
        oldStart: Number(headerMatch[1]),
        oldCount: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
        newCount: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
        lines: []
    };
}

function appendPatchHunkLine(hunk: PatchHunk, line: string): void {
    if (line.startsWith('\\ No newline at end of file')) {
        return;
    }

    const patchLine = parsePatchLine(line);
    if (patchLine) {
        hunk.lines.push(patchLine);
        return;
    }

    if (line === '') {
        throw new Error(`Invalid empty line inside patch hunk at original line ${hunk.oldStart}. Empty context lines must start with a space.`);
    }
    if (!isPatchMetadataLine(line)) {
        throw new Error(`Invalid patch hunk line at original line ${hunk.oldStart}: ${line}`);
    }
}

function parsePatchLine(line: string): PatchLine | null {
    const text = line.slice(1);
    switch (line[0]) {
        case ' ':
            return { type: 'context', text };
        case '-':
            return { type: 'remove', text };
        case '+':
            return { type: 'add', text };
        default:
            return null;
    }
}

function isPatchMetadataLine(line: string): boolean {
    return line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ');
}

function stripPatchFence(patch: string): string {
    const fenced = patch.match(/^\s*```(?:diff|patch)?\n([\s\S]*?)\n```\s*$/);
    return fenced ? fenced[1] : patch;
}

function splitContentLines(content: string): string[] {
    if (content === '') {
        return [];
    }
    const withoutFinalNewline = content.endsWith('\n') ? content.slice(0, -1) : content;
    return withoutFinalNewline.split('\n');
}

function joinContentLines(lines: string[], hadFinalNewline: boolean): string {
    if (lines.length === 0) {
        return '';
    }
    return `${lines.join('\n')}${hadFinalNewline ? '\n' : ''}`;
}

function findHunkLocation(lines: string[], oldLines: string[], preferredIndex: number, oldStart: number): number {
    if (oldLines.length === 0) {
        return Math.min(preferredIndex, lines.length);
    }

    if (sequenceMatches(lines, oldLines, preferredIndex)) {
        return preferredIndex;
    }

    const matches: number[] = [];
    for (let index = 0; index <= lines.length - oldLines.length; index++) {
        if (sequenceMatches(lines, oldLines, index)) {
            matches.push(index);
        }
    }

    if (matches.length === 0) {
        throw new Error(`Patch hunk did not match file content near original line ${oldStart}. Include more unchanged context lines.`);
    }
    if (matches.length > 1) {
        throw new Error(`Patch hunk is ambiguous near original line ${oldStart}; it matched ${matches.length} locations. Include more context lines.`);
    }

    return matches[0];
}

function sequenceMatches(lines: string[], expected: string[], startIndex: number): boolean {
    if (startIndex < 0 || startIndex + expected.length > lines.length) {
        return false;
    }
    return expected.every((line, offset) => lines[startIndex + offset] === line);
}
