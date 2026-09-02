import { spawn } from 'child_process';
import type * as vscode from 'vscode';
import type { LocalTool } from './types';
import { textResult } from './result';
import { getNumberArg } from './filesystemUtils';
import { createSearchCodeFallbackNotice, searchCodeInProcess } from './searchCodeFallback';
import { formatSearchCodeOutput, type SearchCodeResult } from './searchCodeOutput';
import { appendRipgrepMatch } from './searchCodeRipgrepOutput';
import { createRipgrepStartError, resolveRipgrepCommand, RipgrepUnavailableError } from './ripgrep';
import { createSearchCodeRipgrepArgs } from './searchCodeRipgrepArgs';
import {
    DEFAULT_MATCH_LINE_MAX_CHARS,
    getBoundedSearchLineMaxChars,
    getSearchCodeMatchMode,
    MAX_MATCH_LINE_MAX_CHARS,
    MIN_MATCH_LINE_MAX_CHARS,
} from './searchCodeUtils';
import type { SearchCodeOptions } from './searchCodeTypes';
import { WORKSPACE_SEARCH_PATH_DESCRIPTION, resolveWorkspaceRelativeDirectory } from './workspacePath';

export const searchCodeTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'search_code',
        description: [
            'Search text content inside workspace files.',
            'Returns relative file paths with line numbers and matching lines, ordered by path and line number.',
            'Backed by ripgrep when available and follows ripgrep default ignore behavior, so .gitignore/.ignore/.rgignore may hide files.',
            'Git metadata directories are always skipped.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    minLength: 1,
                    description: [
                        'Text to search for.',
                        'match "substring" searches for a literal contained substring.',
                        'match "regex" treats this as a ripgrep regular expression.',
                        'When using regex syntax such as |, .*, groups, character classes, or \\b, set match to "regex".'
                    ].join(' ')
                },
                path: { type: 'string', description: WORKSPACE_SEARCH_PATH_DESCRIPTION },
                include: { type: 'string', description: 'Optional glob for files to include, for example "**/*.ts".' },
                case_sensitive: { type: 'boolean', description: 'Whether matching is case-sensitive. Default: false.', default: false },
                match: {
                    type: 'string',
                    enum: ['substring', 'regex'],
                    description: [
                        'How to interpret query.',
                        '"substring" is a literal contained substring and treats regex metacharacters as plain text.',
                        '"regex" is a ripgrep regular expression; use it for |, .*, groups, character classes, or \\b.',
                        'Default: substring.'
                    ].join(' '),
                    default: 'substring'
                },
                max_results: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 500,
                    description: 'Maximum matching lines to return. If this limit is reached, output includes a limited-results notice. Default: 100.',
                    default: 100
                },
                max_line_chars: {
                    type: 'integer',
                    minimum: MIN_MATCH_LINE_MAX_CHARS,
                    maximum: MAX_MATCH_LINE_MAX_CHARS,
                    description: [
                        'Maximum characters to return from each matching line.',
                        'Long lines are cropped around the match. Default: 500.'
                    ].join(' '),
                    default: DEFAULT_MATCH_LINE_MAX_CHARS
                }
            },
            required: ['query']
        },
        annotations: { readOnlyHint: true }
    },
    async execute(args, context) {
        const searchRoot = (await resolveWorkspaceRelativeDirectory(context.workspaceRoot, args.path ?? '.')).absolutePath;
        const workspaceRoot = context.workspaceRoot ?? searchRoot;
        const query = String(args.query);
        context.metricsCollector.recordSearch(query);
        const maxResults = getNumberArg(args.max_results, 100);
        const options = {
            searchRoot,
            workspaceRoot,
            query,
            maxResults,
            includePattern: typeof args.include === 'string' ? args.include : undefined,
            caseSensitive: args.case_sensitive === true,
            useRegex: getSearchCodeMatchMode(args.match) === 'regex',
            matchLineMaxChars: getBoundedSearchLineMaxChars(args.max_line_chars)
        };
        const result = await runRipgrepWithFallback(options, context.outputChannel);

        return textResult(formatSearchCodeOutput(result, options));
    }
};

async function runRipgrepWithFallback(
    options: SearchCodeOptions,
    outputChannel: vscode.OutputChannel
): Promise<SearchCodeResult> {
    try {
        return await runRipgrep(options);
    } catch (error) {
        if (error instanceof RipgrepUnavailableError) {
            logRipgrepFallback(outputChannel, error);
            const result = await searchCodeInProcess(options);
            return {
                ...result,
                notices: createSearchCodeFallbackNotice().split('\n')
            };
        }

        throw error;
    }
}

function logRipgrepFallback(outputChannel: vscode.OutputChannel, error: RipgrepUnavailableError): void {
    outputChannel.appendLine('[search_code] ripgrep unavailable; using in-process fallback.');
    for (const line of error.message.split('\n')) {
        outputChannel.appendLine(`[search_code] ${line}`);
    }
}

async function runRipgrep(options: SearchCodeOptions): Promise<SearchCodeResult> {
    const rgCommand = resolveRipgrepCommand();
    const args = createSearchCodeRipgrepArgs(options);
    const matches: string[] = [];
    let limitReached = false;
    let stdoutBuffer = '';
    let stderr = '';

    return new Promise((resolve, reject) => {
        const child = spawn(rgCommand.command, args, {
            cwd: options.searchRoot,
            windowsHide: true
        });
        let spawnFailed = false;

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            stdoutBuffer += chunk;

            let newlineIndex = stdoutBuffer.indexOf('\n');
            while (newlineIndex >= 0) {
                const line = stdoutBuffer.slice(0, newlineIndex);
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                appendRipgrepMatch(line, options, matches);

                if (matches.length >= options.maxResults) {
                    limitReached = true;
                    child.kill();
                    break;
                }

                newlineIndex = stdoutBuffer.indexOf('\n');
            }
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', error => {
            spawnFailed = true;
            reject(createRipgrepStartError(error, rgCommand));
        });
        child.on('close', code => {
            if (spawnFailed) {
                return;
            }
            if (stdoutBuffer.trim() && matches.length < options.maxResults) {
                appendRipgrepMatch(stdoutBuffer, options, matches);
            }

            if (code === 0 || code === 1 || limitReached) {
                resolve({
                    matches: matches.slice(0, options.maxResults),
                    limited: limitReached
                });
                return;
            }

            reject(new Error(`search_code failed: ${stderr.trim() || `ripgrep exited with code ${code ?? 'unknown'}`}`));
        });
    });
}
