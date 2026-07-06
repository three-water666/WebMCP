import { spawn } from 'child_process';
import * as vscode from 'vscode';

import { t } from '../i18n';

export interface BrowserLaunchCommand {
    command: string;
    prefixArgs: string[];
    transformBrowserArgs?: (browserArgs: string[]) => string[];
    windowsHide?: boolean;
}

interface BrowserLaunchOptions {
    outputChannel?: vscode.OutputChannel;
}

interface BrowserLaunchFailure {
    command: string;
    message: string;
}

const BROWSER_STABLE_LAUNCH_MS = 1000;

export function launchFirstAvailableBrowser(
    launchCommands: BrowserLaunchCommand[],
    browserArgs: string[],
    browserName: string,
    options: BrowserLaunchOptions = {}
): void {
    logBrowserLaunch(options.outputChannel, `Launching ${browserName} with ${launchCommands.length} candidate(s).`);
    logBrowserLaunch(options.outputChannel, `Arguments: ${formatArgsForLog(browserArgs)}`);

    const tryLaunch = (index: number, failures: BrowserLaunchFailure[]) => {
        const launchCommand = launchCommands[index];
        if (!launchCommand) {
            showLaunchFailure(browserName, failures, options.outputChannel);
            return;
        }

        launchBrowserCandidate(launchCommand, browserArgs, browserName, options.outputChannel, failure => {
            tryLaunch(index + 1, [...failures, failure]);
        });
    };

    tryLaunch(0, []);
}

function launchBrowserCandidate(
    launchCommand: BrowserLaunchCommand,
    browserArgs: string[],
    browserName: string,
    outputChannel: vscode.OutputChannel | undefined,
    onFailure: (failure: BrowserLaunchFailure) => void
): void {
    let settled = false;
    let stableTimer: NodeJS.Timeout | undefined;
    const displayCommand = formatCommandForLog(launchCommand, browserArgs);
    const commandBrowserArgs = getCommandBrowserArgs(launchCommand, browserArgs);

    logBrowserLaunch(outputChannel, `Trying ${browserName}: ${displayCommand}`);

    const child = spawn(launchCommand.command, [...launchCommand.prefixArgs, ...commandBrowserArgs], {
        detached: true,
        stdio: 'ignore',
        windowsHide: launchCommand.windowsHide ?? false
    });

    const continueWithFailure = (message: string) => {
        if (settled) {
            return;
        }

        settled = true;
        if (stableTimer) {
            clearTimeout(stableTimer);
        }

        logBrowserLaunch(outputChannel, `Failed ${browserName}: ${displayCommand} (${message})`);
        onFailure({ command: displayCommand, message });
    };

    child.once('error', (error: NodeJS.ErrnoException) => {
        continueWithFailure(error.code === 'ENOENT' ? 'command not found' : error.message);
    });

    child.once('spawn', () => {
        stableTimer = setTimeout(() => {
            settled = true;
            child.unref();
            logBrowserLaunch(outputChannel, `Started ${browserName}: ${displayCommand}`);
        }, BROWSER_STABLE_LAUNCH_MS);
    });

    child.once('close', (code, signal) => {
        if (settled) {
            return;
        }

        if (code === 0) {
            settled = true;
            if (stableTimer) {
                clearTimeout(stableTimer);
            }
            logBrowserLaunch(outputChannel, `Launch command finished for ${browserName}: ${displayCommand}`);
            return;
        }

        continueWithFailure(t('browser_exited_immediately', {
            browser: browserName,
            command: launchCommand.command,
            reason: formatBrowserExitReason(code, signal)
        }));
    });
}

function showLaunchFailure(
    browserName: string,
    failures: BrowserLaunchFailure[],
    outputChannel: vscode.OutputChannel | undefined
): void {
    if (failures.length > 0) {
        const lastFailure = failures[failures.length - 1];
        logBrowserLaunch(
            outputChannel,
            `All ${failures.length} candidate(s) failed for ${browserName}. Last failure: ${lastFailure.command} (${lastFailure.message})`
        );
        showBrowserLaunchError(
            t('browser_launch_failed', { browser: browserName, message: lastFailure.message }),
            outputChannel
        );
        return;
    }

    showBrowserLaunchError(t('browser_not_found', { browser: browserName }), outputChannel);
}

function formatBrowserExitReason(code: number | null, signal: NodeJS.Signals | null): string {
    if (code !== null) {
        return `exit code ${code}`;
    }

    return signal ? `signal ${signal}` : 'unknown reason';
}

function showBrowserLaunchError(message: string, outputChannel: vscode.OutputChannel | undefined): void {
    const viewLogsLabel = t('view_logs_label');
    const shown = outputChannel
        ? vscode.window.showErrorMessage(message, viewLogsLabel)
        : vscode.window.showErrorMessage(message);

    if (!outputChannel) {
        return;
    }

    void shown.then(selection => {
        if (selection === viewLogsLabel) {
            outputChannel.show();
        }
    });
}

function logBrowserLaunch(outputChannel: vscode.OutputChannel | undefined, message: string): void {
    outputChannel?.appendLine(`[BrowserLauncher] ${message}`);
}

function formatCommandForLog(launchCommand: BrowserLaunchCommand, browserArgs: string[]): string {
    const commandBrowserArgs = getCommandBrowserArgs(launchCommand, browserArgs.map(redactArgForLog));

    return formatArgsForLog([launchCommand.command, ...launchCommand.prefixArgs, ...commandBrowserArgs], {
        alreadyRedacted: true
    });
}

function getCommandBrowserArgs(launchCommand: BrowserLaunchCommand, browserArgs: string[]): string[] {
    return launchCommand.transformBrowserArgs?.(browserArgs) ?? browserArgs;
}

function formatArgsForLog(args: string[], options: { alreadyRedacted?: boolean } = {}): string {
    return args
        .map(arg => quoteArgForLog(options.alreadyRedacted ? arg : redactArgForLog(arg)))
        .join(' ');
}

function quoteArgForLog(arg: string): string {
    if (!arg) {
        return '""';
    }

    return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function redactArgForLog(arg: string): string {
    if (!/^https?:\/\//i.test(arg)) {
        return arg;
    }

    try {
        const url = new URL(arg);
        if (url.searchParams.has('bridgeToken')) {
            url.searchParams.set('bridgeToken', 'redacted');
        }
        return url.toString();
    } catch {
        return '<url>';
    }
}
