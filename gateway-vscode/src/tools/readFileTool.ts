import * as fs from 'fs/promises';
import { BUILTIN_SKILL_VIRTUAL_ROOT, isBuiltinSkillVirtualPathCandidate } from '../builtinSkills';
import type { LocalTool, ToolExecutionContext, ToolResult } from './types';
import { normalizeLineEndings } from './filesystemUtils';
import { readFilePrefix } from './readFilePrefix';
import { readSelectedFileLines, type LineSelectionOptions, type SelectedFileLines } from './readFileLineStream';
import { WORKSPACE_FILE_PATH_DESCRIPTION, resolveWorkspaceRelativePath } from './workspacePath';
import {
    formatLimitedReadFileOutput,
    READ_FILE_OUTPUT_MAX_BYTES,
    READ_FILE_OUTPUT_MAX_LINES,
    type LimitedReadFileOutput,
    type ReadFileTruncationReason
} from './readFileOutputLimit';

export { readFilePrefix } from './readFilePrefix';

const READ_FILE_PATH_DESCRIPTION = `${WORKSPACE_FILE_PATH_DESCRIPTION} Read-only built-in skill virtual paths under ` +
    `${BUILTIN_SKILL_VIRTUAL_ROOT}/ are also supported.`;

export const readFileTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'read_file',
        description: 'Read a UTF-8 text file inside the current VS Code workspace, or a read-only built-in skill virtual path. ' +
            'Supports head, tail, start_line/end_line, and show_line_numbers to inspect code without shell commands.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: READ_FILE_PATH_DESCRIPTION },
                head: { type: 'integer', minimum: 1, description: 'Optional number of lines to read from the start of the file.' },
                tail: { type: 'integer', minimum: 1, description: 'Optional number of lines to read from the end of the file.' },
                start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based first line to read. Must be used with end_line and without head or tail.' },
                end_line: { type: 'integer', minimum: 1, description: 'Optional 1-based last line to read, inclusive. Must be used with start_line and without head or tail.' },
                show_line_numbers: { type: 'boolean', description: 'Prefix each returned line with its 1-based line number. Default: false.', default: false }
            },
            required: ['path']
        },
        annotations: { readOnlyHint: true }
    },
    async execute(args, context) {
        const builtinResult = await readBuiltinSkillVirtualContent(args, context);
        if (builtinResult) {
            return formatReadFileToolResult(builtinResult);
        }

        const filePath = (await resolveWorkspaceRelativePath(context.workspaceRoot, args.path)).absolutePath;
        context.metricsCollector.recordFileRead(String(args.path));
        const fileStats = await fs.stat(filePath);
        const result = await readFileContent(filePath, fileStats.size, args);
        return formatReadFileToolResult(result);
    }
};

export function selectReadFileContent(content: string, args: Record<string, unknown>): string {
    return selectReadFileResult(content, args).text;
}

type ReadFileResult = {
    text: string;
    metadata?: ReadFileMetadata;
};

type ReadFileMetadata = {
    truncated: true;
    reason: ReadFileTruncationReason;
    returnedLines: {
        start: number;
        end: number;
    };
    lineCountKnown: boolean;
    lineCount?: number;
    returnedBytes?: number;
    fileBytes?: number;
};

type ReadFileResultDetails = {
    fileBytes?: number;
    lineCountKnown: boolean;
    lineCount?: number;
    returnedLines: {
        start: number;
        end: number;
    };
};

type ReadFileTruncationDetails = {
    reason: ReadFileTruncationReason;
    returnedLines: {
        start: number;
        end: number;
    };
    lineCountKnown: boolean;
    lineCount?: number;
    returnedBytes?: number;
    fileBytes?: number;
};

type ReadFileResultOptions = {
    fileBytes?: number;
    prefixLimitApplied?: boolean;
    byteLimitApplied?: boolean;
    totalLineCountKnown?: boolean;
};

async function readBuiltinSkillVirtualContent(
    args: Record<string, unknown>,
    context: ToolExecutionContext
): Promise<ReadFileResult | null> {
    if (!isBuiltinSkillVirtualPathCandidate(args.path)) {
        return null;
    }

    const virtualFile = await context.skillManager.resolveBuiltinSkillVirtualFile(args.path);
    if (virtualFile.status === 'missing') {
        throw new Error(`Built-in skill virtual path not found: ${virtualFile.path}`);
    }
    if (virtualFile.status === 'not_builtin') {
        return null;
    }

    return readFileContent(virtualFile.absolutePath, virtualFile.bytes, args);
}

function formatReadFileToolResult(result: ReadFileResult): ToolResult {
    return {
        content: [{ type: 'text', text: result.text }],
        ...(result.metadata === undefined ? {} : { structuredContent: result.metadata })
    };
}

export async function readFileContent(
    filePath: string,
    fileBytes: number,
    args: Record<string, unknown>
): Promise<ReadFileResult> {
    const lineOptions = getLineSelectionOptions(args);

    if (hasLineSelection(lineOptions)) {
        return readSelectedFileContent(filePath, args, lineOptions, fileBytes);
    }

    if (fileBytes <= READ_FILE_OUTPUT_MAX_BYTES) {
        return selectReadFileResult(normalizeLineEndings(await fs.readFile(filePath, 'utf8')), args, { fileBytes });
    }

    const content = normalizeLineEndings(await readFilePrefix(filePath, READ_FILE_OUTPUT_MAX_BYTES));
    return selectReadFileResult(content, args, {
        fileBytes,
        prefixLimitApplied: true,
        byteLimitApplied: true,
        totalLineCountKnown: false
    });
}

export function selectReadFileResult(
    content: string,
    args: Record<string, unknown>,
    options: ReadFileResultOptions = {}
): ReadFileResult {
    const lines = splitLines(content);
    const lineOptions = getLineSelectionOptions(args);
    const selection = resolveLineSelection(lines.length, lineOptions);
    const showLineNumbers = args.show_line_numbers === true;
    const prefixLimitApplied = options.prefixLimitApplied === true;
    const totalLineCountKnown = options.totalLineCountKnown !== false;

    if (selection) {
        const limited = formatLimitedReadFileOutput(
            lines.slice(selection.startIndex, selection.endIndex),
            selection.startIndex + 1,
            showLineNumbers,
            { preserveLastLines: lineOptions.tail !== undefined }
        );
        return buildReadFileResult(limited, {
            fileBytes: options.fileBytes,
            lineCountKnown: totalLineCountKnown,
            lineCount: totalLineCountKnown ? lines.length : undefined,
            returnedLines: getReturnedLineRange(limited.firstLineNumber, limited.returnedLineCount)
        });
    }

    const limited = formatLimitedReadFileOutput(lines, 1, showLineNumbers, {
        byteLimitAlreadyApplied: options.byteLimitApplied === true
    });

    if (!prefixLimitApplied && limited.truncationReason === undefined) {
        return { text: limited.text };
    }

    return buildReadFileResult(limited, {
        fileBytes: options.fileBytes,
        lineCountKnown: totalLineCountKnown,
        lineCount: totalLineCountKnown ? lines.length : undefined,
        returnedLines: getReturnedLineRange(limited.firstLineNumber, limited.returnedLineCount)
    });
}

function buildReadFileResult(limited: LimitedReadFileOutput, details: ReadFileResultDetails): ReadFileResult {
    if (limited.truncationReason === undefined) {
        return { text: limited.text };
    }

    const text = formatReadFileResultText(limited, details.fileBytes, details.lineCount);
    return {
        text,
        metadata: createReadFileMetadata({
            reason: limited.truncationReason,
            lineCountKnown: details.lineCountKnown,
            lineCount: details.lineCount,
            returnedLines: details.returnedLines,
            returnedBytes: Buffer.byteLength(text, 'utf8'),
            fileBytes: details.fileBytes
        })
    };
}

function createReadFileMetadata(details: ReadFileTruncationDetails): ReadFileMetadata {
    return {
        truncated: true,
        reason: details.reason,
        returnedLines: details.returnedLines,
        lineCountKnown: details.lineCountKnown,
        lineCount: details.lineCount,
        returnedBytes: details.returnedBytes,
        fileBytes: details.fileBytes
    };
}

type LineSelection = {
    startIndex: number;
    endIndex: number;
};

function resolveLineSelection(lineCount: number, options: LineSelectionOptions): LineSelection | null {
    const { head, tail, startLine, endLine } = options;
    if (head !== undefined) {
        return { startIndex: 0, endIndex: Math.min(head, lineCount) };
    }

    if (tail !== undefined) {
        const startIndex = Math.max(lineCount - tail, 0);
        return { startIndex, endIndex: lineCount };
    }

    if (startLine !== undefined && endLine !== undefined) {
        const startIndex = Math.min(Math.max(startLine - 1, 0), lineCount);
        return {
            startIndex,
            endIndex: Math.min(endLine, lineCount)
        };
    }

    return null;
}

function getReturnedLineRange(firstLineNumber: number, returnedLineCount: number): { start: number; end: number } {
    if (returnedLineCount <= 0) {
        return { start: 0, end: 0 };
    }

    return {
        start: firstLineNumber,
        end: firstLineNumber + returnedLineCount - 1
    };
}

function formatReadFileResultText(limited: LimitedReadFileOutput, fileBytes?: number, lineCount?: number): string {
    if (limited.truncationReason === undefined) {
        return limited.text;
    }

    return appendTruncationNotice(limited.text, {
        fileBytes,
        returnedLines: limited.returnedLineCount,
        lineCount,
        truncationReason: limited.truncationReason
    });
}

async function readSelectedFileContent(
    filePath: string,
    args: Record<string, unknown>,
    options: LineSelectionOptions,
    fileBytes: number
): Promise<ReadFileResult> {
    const selected = await readSelectedFileLines(filePath, capLineSelectionOptions(options));
    const showLineNumbers = args.show_line_numbers === true;
    const limited = formatLimitedReadFileOutput(selected.lines, selected.startLine, showLineNumbers, {
        lineLimitAlreadyApplied: didLineSelectionHitOutputLimit(options, selected),
        preserveLastLines: options.tail !== undefined
    });
    return buildReadFileResult(limited, {
        fileBytes,
        lineCountKnown: selected.lineCount !== undefined,
        lineCount: selected.lineCount,
        returnedLines: getReturnedLineRange(limited.firstLineNumber, limited.returnedLineCount)
    });
}

function getLineSelectionOptions(args: Record<string, unknown>): LineSelectionOptions {
    const options = {
        head: getPositiveIntegerArg(args.head),
        tail: getPositiveIntegerArg(args.tail),
        startLine: getPositiveIntegerArg(args.start_line),
        endLine: getPositiveIntegerArg(args.end_line)
    };
    assertCompatibleLineOptions(options);
    return options;
}

function hasLineSelection(options: LineSelectionOptions): boolean {
    return options.head !== undefined ||
        options.tail !== undefined ||
        options.startLine !== undefined ||
        options.endLine !== undefined;
}

function capLineSelectionOptions(options: LineSelectionOptions): LineSelectionOptions {
    if (options.head !== undefined) {
        return { ...options, head: Math.min(options.head, READ_FILE_OUTPUT_MAX_LINES) };
    }
    if (options.tail !== undefined) {
        return { ...options, tail: Math.min(options.tail, READ_FILE_OUTPUT_MAX_LINES) };
    }
    if (options.startLine !== undefined || options.endLine !== undefined) {
        const startLine = options.startLine ?? 1;
        const maxEndLine = startLine + READ_FILE_OUTPUT_MAX_LINES - 1;
        return { ...options, endLine: Math.min(options.endLine ?? maxEndLine, maxEndLine) };
    }
    return options;
}

function didLineSelectionHitOutputLimit(options: LineSelectionOptions, selected: SelectedFileLines): boolean {
    const requestedLineCount = getRequestedLineCount(options);
    if (requestedLineCount <= READ_FILE_OUTPUT_MAX_LINES || selected.lines.length < READ_FILE_OUTPUT_MAX_LINES) {
        return false;
    }
    if (options.tail !== undefined) {
        return selected.lineCount === undefined || selected.lineCount > READ_FILE_OUTPUT_MAX_LINES;
    }
    if (options.head !== undefined) {
        return selected.lineCount === undefined || selected.lineCount > READ_FILE_OUTPUT_MAX_LINES;
    }
    return didRangeSelectionHitOutputLimit(options, selected);
}

function didRangeSelectionHitOutputLimit(options: LineSelectionOptions, selected: SelectedFileLines): boolean {
    if (selected.lineCount === undefined) {
        return true;
    }
    const startLine = options.startLine ?? 1;
    const requestedEndLine = options.endLine ?? selected.lineCount;
    const availableEndLine = Math.min(requestedEndLine, selected.lineCount);
    return Math.max(availableEndLine - startLine + 1, 0) > READ_FILE_OUTPUT_MAX_LINES;
}

function getRequestedLineCount(options: LineSelectionOptions): number {
    if (options.head !== undefined) {
        return options.head;
    }
    if (options.tail !== undefined) {
        return options.tail;
    }
    const startLine = options.startLine ?? 1;
    return options.endLine === undefined ? Number.POSITIVE_INFINITY : options.endLine - startLine + 1;
}

function assertCompatibleLineOptions(options: {
    head?: number;
    tail?: number;
    startLine?: number;
    endLine?: number;
}): void {
    const { head, tail, startLine, endLine } = options;
    const hasRange = startLine !== undefined || endLine !== undefined;
    if (hasBothHeadAndTail(head, tail)) {
        throw new Error('Cannot specify both head and tail.');
    }

    if (hasHeadOrTailWithRange(head, tail, hasRange)) {
        throw new Error('Cannot specify head or tail with start_line or end_line.');
    }

    if (hasRange && (startLine === undefined || endLine === undefined)) {
        throw new Error('start_line and end_line must be specified together.');
    }

    if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
        throw new Error('start_line must be less than or equal to end_line.');
    }
}

function hasBothHeadAndTail(head: number | undefined, tail: number | undefined): boolean {
    return head !== undefined && tail !== undefined;
}

function hasHeadOrTailWithRange(head: number | undefined, tail: number | undefined, hasRange: boolean): boolean {
    return (head !== undefined || tail !== undefined) && hasRange;
}

function getPositiveIntegerArg(value: unknown): number | undefined {
    if (typeof value !== 'number') {
        return undefined;
    }

    if (!Number.isInteger(value) || value < 1) {
        throw new Error('Line options must be positive integers.');
    }

    return value;
}

function splitLines(content: string): string[] {
    if (content === '') {
        return [];
    }
    return content.split('\n');
}

function appendTruncationNotice(
    content: string,
    details: {
        fileBytes?: number;
        returnedLines: number;
        lineCount?: number;
        truncationReason: ReadFileTruncationReason;
    }
): string {
    const totalLinesText = details.lineCount === undefined ? '' : ` of ${details.lineCount}`;
    const sizeText = details.fileBytes === undefined ? '' : ` File size: ${formatBytes(details.fileBytes)}.`;
    const notice = [
        '',
        `[read_file] Output truncated; returned ${details.returnedLines} line(s)${totalLinesText}. Reason: ${details.truncationReason}.${sizeText}`,
        `[read_file] Use a narrower line range with start_line/end_line, head, or tail to read more.`
    ].join('\n');

    return content ? `${content}\n${notice}` : notice.trimStart();
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
