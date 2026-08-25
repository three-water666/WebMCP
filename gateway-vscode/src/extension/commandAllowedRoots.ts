import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';

export function resolveCommandAllowedRoots(
    configuredRoots: string[],
    workspaceRoot: string,
    outputChannel: vscode.OutputChannel
): string[] {
    const normalizedWorkspace = normalizeRoot(workspaceRoot);
    const roots = new Set<string>();

    for (const configuredRoot of configuredRoots) {
        const expanded = expandConfiguredRoot(configuredRoot, workspaceRoot);
        if (!expanded || !path.isAbsolute(expanded)) {
            outputChannel.appendLine(
                `⚠️ Ignoring non-absolute command allowed root: ${configuredRoot}`
            );
            continue;
        }

        try {
            const stats = fs.statSync(expanded);
            if (!stats.isDirectory()) {
                outputChannel.appendLine(
                    `⚠️ Ignoring command allowed root that is not a directory: ${configuredRoot}`
                );
                continue;
            }
            const normalized = normalizeRoot(fs.realpathSync(expanded));
            if (normalized !== normalizedWorkspace) {
                roots.add(normalized);
            }
        } catch {
            outputChannel.appendLine(
                `⚠️ Ignoring command allowed root that cannot be resolved: ${configuredRoot}`
            );
        }
    }

    return Array.from(roots);
}

function expandConfiguredRoot(value: string, workspaceRoot: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    const withWorkspace = trimmed.replace(/^\$\{workspaceFolder\}(?=$|[\\/])/, workspaceRoot);
    if (withWorkspace === '~') {
        return os.homedir();
    }
    if (/^~[\\/]/.test(withWorkspace)) {
        return path.join(os.homedir(), withWorkspace.slice(2));
    }
    return withWorkspace;
}

function normalizeRoot(value: string): string {
    return path.resolve(path.normalize(value));
}
