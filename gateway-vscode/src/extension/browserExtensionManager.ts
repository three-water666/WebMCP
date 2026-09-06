import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { t } from '../i18n';
import {
    resolveBrowserExtensionRoot,
    withBrowserExtensionInstallLock,
    type BrowserExtensionBuild,
    type BrowserExtensionInstallLease,
    type PrepareBrowserExtensionResult
} from './browserExtensionInstall';
import { getErrorMessage } from './errorUtils';
import type { BrowserFamily } from './isolatedBrowserProfiles';
import {
    getBrowserBridgeProcesses,
    getBrowserProfileProcessIds,
    stopBrowserBridgeProcesses,
    stopBrowserProfileProcesses,
    waitForBrowserProfileBridgeProcess,
    type BrowserBridgeProcess
} from './processDetection';

export type BrowserExtensionLaunch = (extensionPath: string) => Promise<boolean>;

export interface BrowserExtensionLaunchOptions {
    browserFamily: BrowserFamily;
    profileDir: string;
    launch: BrowserExtensionLaunch;
}

export interface BrowserExtensionManager {
    prepareInBackground(): void;
    launchWithReadyExtension(options: BrowserExtensionLaunchOptions): Promise<boolean>;
}

interface BrowserRestartPlan {
    browserFamily: BrowserFamily;
    profileDir: string;
    extensionPath: string;
    bridgeProcesses: BrowserBridgeProcess[];
    restartTargetProfile: boolean;
}

const PREPARATION_PROGRESS_DELAY_MS = 300;
const COORDINATION_LOCK_TIMEOUT_MS = 5 * 60_000;

export function createBrowserExtensionManager(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): BrowserExtensionManager {
    return new DefaultBrowserExtensionManager(context, outputChannel);
}

class DefaultBrowserExtensionManager implements BrowserExtensionManager {
    private readonly rootDir: string;
    private backgroundPreparation: Promise<void> | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.rootDir = resolveBrowserExtensionRoot({
            developmentStorageRoot: context.extensionMode === vscode.ExtensionMode.Production
                ? undefined
                : context.globalStorageUri.fsPath
        });
    }

    prepareInBackground(): void {
        void this.getBackgroundPreparation().catch(error => {
            this.log(`Background preparation failed: ${getErrorMessage(error)}`);
        });
    }

    async launchWithReadyExtension(options: BrowserExtensionLaunchOptions): Promise<boolean> {
        try {
            await this.waitForBackgroundPreparationWithProgress();
            const sourceDir = this.requireBundledSource();
            return await withBrowserExtensionInstallLock({
                rootDir: this.rootDir,
                lockTimeoutMs: COORDINATION_LOCK_TIMEOUT_MS
            }, async lease => {
                let prepared = this.validateProtocol(await lease.prepare(sourceDir));
                if (prepared.status === 'newer-installed') {
                    this.showNewerInstalledMessage(prepared.installedBuild);
                    return false;
                }

                const restartPlan = await this.createRestartPlan(
                    prepared,
                    options.browserFamily,
                    options.profileDir
                );
                if (restartPlan && !await this.confirmAndStopRunningBrowsers(restartPlan)) {
                    return false;
                }

                if (prepared.status === 'staged') {
                    prepared = this.validateProtocol(await lease.activate(prepared.build));
                }

                if (prepared.status === 'newer-installed') {
                    this.showNewerInstalledMessage(prepared.installedBuild);
                    return false;
                }
                if (prepared.status !== 'ready') {
                    throw new Error('The prepared browser bridge was not activated.');
                }

                const launched = await options.launch(prepared.extensionPath);
                if (!launched) {
                    return false;
                }
                if (!await waitForBrowserProfileBridgeProcess(
                    options.browserFamily,
                    options.profileDir,
                    prepared.extensionPath
                )) {
                    throw new Error('The isolated browser did not expose its WebCode bridge process in time.');
                }

                this.log(`Using browser bridge ${prepared.build.extensionVersion} from ${prepared.extensionPath}.`);
                return true;
            });
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            this.log(`Preparation failed: ${message}`);
            void vscode.window.showErrorMessage(t('browser_bridge_prepare_failed', {
                path: this.rootDir,
                message
            }));
            return false;
        }
    }

    private getBackgroundPreparation(): Promise<void> {
        if (this.backgroundPreparation) {
            return this.backgroundPreparation;
        }

        const preparation = this.prepareAndActivateWhenSafe();
        this.backgroundPreparation = preparation;
        void preparation.catch(() => {
            if (this.backgroundPreparation === preparation) {
                this.backgroundPreparation = undefined;
            }
        });
        return preparation;
    }

    private async prepareAndActivateWhenSafe(): Promise<void> {
        const sourceDir = this.requireBundledSource();
        await withBrowserExtensionInstallLock({ rootDir: this.rootDir }, async lease => {
            const prepared = this.validateProtocol(await lease.prepare(sourceDir));
            await this.activateBackgroundPreparationWhenSafe(prepared, lease);
        });
    }

    private async activateBackgroundPreparationWhenSafe(
        prepared: PrepareBrowserExtensionResult,
        lease: BrowserExtensionInstallLease
    ): Promise<void> {
        if (prepared.status === 'newer-installed') {
            this.log(`A newer browser bridge ${prepared.installedBuild.extensionVersion} is already installed.`);
            return;
        }
        if (prepared.status === 'ready') {
            this.log(`Browser bridge ${prepared.build.extensionVersion} is ready.`);
            return;
        }

        const runningBrowsers = await getBrowserBridgeProcesses(prepared.extensionPath);
        if (runningBrowsers.length > 0) {
            this.log(`Browser bridge ${prepared.build.extensionVersion} is staged until the isolated browser restarts.`);
            return;
        }

        const activated = this.validateProtocol(await lease.activate(prepared.build));
        if (activated.status === 'ready') {
            this.log(`Browser bridge ${activated.build.extensionVersion} prepared at ${activated.extensionPath}.`);
        }
    }

    private validateProtocol(result: PrepareBrowserExtensionResult): PrepareBrowserExtensionResult {
        if (result.status !== 'newer-installed' &&
            result.build.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
            throw new Error(
                `Browser bridge protocol ${result.build.bridgeProtocolVersion} does not match ` +
                `gateway protocol ${BRIDGE_PROTOCOL_VERSION}.`
            );
        }
        return result;
    }

    private requireBundledSource(): string {
        const sourceDir = resolveBundledBrowserExtensionSource(this.context);
        if (!sourceDir) {
            throw new Error(t('browser_extension_missing'));
        }
        return sourceDir;
    }

    private async waitForBackgroundPreparationWithProgress(): Promise<void> {
        const preparation = this.getBackgroundPreparation();
        let timer: NodeJS.Timeout | undefined;
        const outcome = await Promise.race([
            preparation.then(() => 'ready' as const),
            new Promise<'slow'>(resolve => {
                timer = setTimeout(() => resolve('slow'), PREPARATION_PROGRESS_DELAY_MS);
            })
        ]);
        if (timer) {
            clearTimeout(timer);
        }
        if (outcome === 'ready') {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: t('browser_bridge_preparing'),
            cancellable: false
        }, () => preparation);
    }

    private async createRestartPlan(
        prepared: Exclude<PrepareBrowserExtensionResult, { status: 'newer-installed' }>,
        browserFamily: BrowserFamily,
        profileDir: string
    ): Promise<BrowserRestartPlan | null> {
        const [allBridgeProcesses, profileProcessIds] = await Promise.all([
            getBrowserBridgeProcesses(prepared.extensionPath),
            getBrowserProfileProcessIds(browserFamily, profileDir)
        ]);
        const bridgeProcessIds = new Set(allBridgeProcesses.map(processInfo => processInfo.pid));
        const targetUsesActiveBridge = profileProcessIds.some(processId => bridgeProcessIds.has(processId));
        const bridgeProcesses = prepared.status === 'staged' ? allBridgeProcesses : [];
        const restartTargetProfile = profileProcessIds.length > 0 &&
            (prepared.status === 'staged' || !targetUsesActiveBridge);
        if (bridgeProcesses.length === 0 && !restartTargetProfile) {
            return null;
        }
        return {
            browserFamily,
            profileDir,
            extensionPath: prepared.extensionPath,
            bridgeProcesses,
            restartTargetProfile
        };
    }

    private async confirmAndStopRunningBrowsers(plan: BrowserRestartPlan): Promise<boolean> {
        const browserFamilies = plan.bridgeProcesses.map(processInfo => processInfo.browserFamily);
        if (plan.restartTargetProfile) {
            browserFamilies.push(plan.browserFamily);
        }
        const browserNames = [...new Set(browserFamilies.map(getBrowserDisplayName))].join(' / ');
        const restartButton = t('browser_bridge_restart_button');
        const selection = await vscode.window.showWarningMessage(
            t('browser_bridge_restart_required', { browsers: browserNames }),
            { modal: true },
            restartButton
        );
        if (selection !== restartButton) {
            return false;
        }

        const bridgeStopped = plan.bridgeProcesses.length === 0 ||
            await stopBrowserBridgeProcesses(plan.extensionPath).catch(() => false);
        const profileStopped = !plan.restartTargetProfile ||
            await stopBrowserProfileProcesses(plan.browserFamily, plan.profileDir).catch(() => false);
        if (bridgeStopped && profileStopped) {
            return true;
        }

        void vscode.window.showErrorMessage(t('browser_bridge_restart_failed', { browsers: browserNames }));
        return false;
    }

    private showNewerInstalledMessage(build: BrowserExtensionBuild): void {
        void vscode.window.showErrorMessage(t('browser_bridge_newer_installed', {
            version: build.extensionVersion
        }));
    }

    private log(message: string): void {
        this.outputChannel.appendLine(`[Browser Bridge] ${message}`);
    }
}

function resolveBundledBrowserExtensionSource(context: vscode.ExtensionContext): string | null {
    const candidates = [
        path.join(context.extensionPath, 'browser-extension'),
        path.resolve(context.extensionPath, '..', 'bridge-browser', 'dist'),
        path.resolve(context.extensionPath, '..', '..', 'bridge-browser', 'dist')
    ];
    return candidates.find(candidate =>
        fs.existsSync(path.join(candidate, 'manifest.json')) &&
        fs.existsSync(path.join(candidate, 'bridge-build.json'))
    ) ?? null;
}

function getBrowserDisplayName(browserFamily: 'edge' | 'chrome'): string {
    return browserFamily === 'edge' ? 'Microsoft Edge' : 'Chrome / Chromium';
}
