import { spawn } from 'child_process';
import * as vscode from 'vscode';

import { t } from '../i18n';

export interface BrowserLaunchCommand {
    command: string;
    prefixArgs: string[];
}

interface BrowserLaunchAttempt {
    success: boolean;
    failure?: string;
}

const BROWSER_STABLE_LAUNCH_MS = 1000;

export async function launchFirstAvailableBrowser(
    launchCommands: BrowserLaunchCommand[],
    browserArgs: string[],
    browserName: string
): Promise<boolean> {
    let lastFailure: string | undefined;
    for (const launchCommand of launchCommands) {
        const result = await launchBrowserCandidate(launchCommand, browserArgs, browserName);
        if (result.success) {
            return true;
        }
        lastFailure = result.failure ?? lastFailure;
    }

    showLaunchFailure(browserName, lastFailure);
    return false;
}

function launchBrowserCandidate(
    launchCommand: BrowserLaunchCommand,
    browserArgs: string[],
    browserName: string
): Promise<BrowserLaunchAttempt> {
    return new Promise(resolve => {
        let settled = false;
        let stableTimer: NodeJS.Timeout | undefined;
        const settle = (result: BrowserLaunchAttempt) => {
            if (settled) {
                return;
            }
            settled = true;
            if (stableTimer) {
                clearTimeout(stableTimer);
            }
            resolve(result);
        };

        let child;
        try {
            child = spawn(launchCommand.command, [...launchCommand.prefixArgs, ...browserArgs], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false
            });
        } catch (error: unknown) {
            settle({ success: false, failure: error instanceof Error ? error.message : String(error) });
            return;
        }

        child.once('error', (error: NodeJS.ErrnoException) => {
            settle({ success: false, failure: error.code === 'ENOENT' ? undefined : error.message });
        });

        child.once('spawn', () => {
            stableTimer = setTimeout(() => {
                child.unref();
                settle({ success: true });
            }, BROWSER_STABLE_LAUNCH_MS);
        });

        child.once('close', (code, signal) => {
            if (code === 0) {
                settle({ success: true });
                return;
            }
            settle({
                success: false,
                failure: t('browser_exited_immediately', {
                    browser: browserName,
                    command: launchCommand.command,
                    reason: formatBrowserExitReason(code, signal)
                })
            });
        });
    });
}

function showLaunchFailure(browserName: string, lastFailure?: string): void {
    if (lastFailure) {
        void vscode.window.showErrorMessage(t('open_browser_failed', { message: lastFailure }));
        return;
    }

    void vscode.window.showErrorMessage(t('browser_not_found', { browser: browserName }));
}

function formatBrowserExitReason(code: number | null, signal: NodeJS.Signals | null): string {
    if (code !== null) {
        return `exit code ${code}`;
    }

    return signal ? `signal ${signal}` : 'unknown reason';
}
