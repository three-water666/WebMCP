import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { t } from '../i18n';
import {
    activatePreparedBrowserExtension,
    prepareBrowserExtensionInstall,
    resolveDefaultBrowserExtensionRoot,
    type BrowserExtensionBuild,
    type PrepareBrowserExtensionResult
} from './browserExtensionInstall';
import { getErrorMessage } from './errorUtils';
import {
    BROWSER_FAMILIES,
    resolveIsolatedBrowserProfilePaths,
    type BrowserFamily
} from './isolatedBrowserProfiles';
import { getBrowserProfileProcessIds, stopBrowserProfileProcesses } from './processDetection';

export interface BrowserExtensionManager {
    prepareInBackground(): void;
    ensureReadyForLaunch(): Promise<string | null>;
}

interface RunningIsolatedProfile {
    browserFamily: BrowserFamily;
    profileDir: string;
    processIds: number[];
}

const PREPARATION_PROGRESS_DELAY_MS = 300;

export function createBrowserExtensionManager(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): BrowserExtensionManager {
    return new DefaultBrowserExtensionManager(context, outputChannel);
}

class DefaultBrowserExtensionManager implements BrowserExtensionManager {
    private readonly rootDir: string;
    private preparationPromise: Promise<PrepareBrowserExtensionResult> | undefined;
    private activationPromise: Promise<PrepareBrowserExtensionResult> | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.rootDir = resolveBrowserExtensionRoot();
    }

    prepareInBackground(): void {
        void this.prepareAndActivateWhenSafe().catch(error => {
            this.log(`Background preparation failed: ${getErrorMessage(error)}`);
        });
    }

    async ensureReadyForLaunch(): Promise<string | null> {
        try {
            let prepared = await this.waitForPreparationWithProgress();
            if (prepared.status === 'staged') {
                prepared = this.activationPromise
                    ? await this.activationPromise
                    : await this.refreshPreparation();
            }
            if (prepared.status === 'newer-installed') {
                this.showNewerInstalledMessage(prepared.installedBuild);
                return null;
            }
            if (prepared.status === 'ready') {
                return prepared.extensionPath;
            }

            const runningProfiles = await this.findRunningIsolatedProfiles();
            if (runningProfiles.length > 0 && !await this.confirmAndStopRunningProfiles(runningProfiles)) {
                return null;
            }

            const activated = await this.activate(prepared.build);
            if (activated.status === 'newer-installed') {
                this.showNewerInstalledMessage(activated.installedBuild);
                return null;
            }
            if (activated.status !== 'ready') {
                throw new Error('The prepared browser bridge was not activated.');
            }
            this.preparationPromise = Promise.resolve(activated);
            this.log(`Using browser bridge ${activated.build.extensionVersion} from ${activated.extensionPath}.`);
            return activated.extensionPath;
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            this.log(`Preparation failed: ${message}`);
            void vscode.window.showErrorMessage(t('browser_bridge_prepare_failed', {
                path: this.rootDir,
                message
            }));
            return null;
        }
    }

    private async prepareAndActivateWhenSafe(): Promise<void> {
        const prepared = await this.getPreparation();
        if (prepared.status !== 'staged') {
            if (prepared.status === 'ready') {
                this.log(`Browser bridge ${prepared.build.extensionVersion} is ready.`);
            }
            return;
        }

        const runningProfiles = await this.findRunningIsolatedProfiles();
        if (runningProfiles.length > 0) {
            this.log(`Browser bridge ${prepared.build.extensionVersion} is staged until the isolated browser restarts.`);
            return;
        }

        const activated = await this.activate(prepared.build);
        if (activated.status === 'ready') {
            this.preparationPromise = Promise.resolve(activated);
            this.log(`Browser bridge ${activated.build.extensionVersion} prepared at ${activated.extensionPath}.`);
        }
    }

    private getPreparation(): Promise<PrepareBrowserExtensionResult> {
        if (this.preparationPromise) {
            return this.preparationPromise;
        }

        const sourceDir = resolveBundledBrowserExtensionSource(this.context);
        if (!sourceDir) {
            return Promise.reject(new Error(t('browser_extension_missing')));
        }

        const preparation = prepareBrowserExtensionInstall({ sourceDir, rootDir: this.rootDir })
            .then(result => {
                if (result.status !== 'newer-installed' &&
                    result.build.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
                    throw new Error(
                        `Browser bridge protocol ${result.build.bridgeProtocolVersion} does not match ` +
                        `gateway protocol ${BRIDGE_PROTOCOL_VERSION}.`
                    );
                }
                return result;
            });
        this.preparationPromise = preparation;
        void preparation.catch(() => {
            if (this.preparationPromise === preparation) {
                this.preparationPromise = undefined;
            }
        });
        return preparation;
    }

    private activate(build: BrowserExtensionBuild): Promise<PrepareBrowserExtensionResult> {
        if (this.activationPromise) {
            return this.activationPromise;
        }
        const activation = activatePreparedBrowserExtension({ rootDir: this.rootDir }, build);
        this.activationPromise = activation;
        const clearActivation = () => {
            if (this.activationPromise === activation) {
                this.activationPromise = undefined;
            }
        };
        void activation.then(clearActivation, clearActivation);
        return activation;
    }

    private refreshPreparation(): Promise<PrepareBrowserExtensionResult> {
        this.preparationPromise = undefined;
        return this.getPreparation();
    }

    private async waitForPreparationWithProgress(): Promise<PrepareBrowserExtensionResult> {
        const preparation = this.getPreparation();
        let timer: NodeJS.Timeout | undefined;
        const outcome = await Promise.race([
            preparation.then(result => ({ kind: 'ready' as const, result })),
            new Promise<{ kind: 'slow' }>(resolve => {
                timer = setTimeout(() => resolve({ kind: 'slow' }), PREPARATION_PROGRESS_DELAY_MS);
            })
        ]);
        if (timer) {
            clearTimeout(timer);
        }
        if (outcome.kind === 'ready') {
            return outcome.result;
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: t('browser_bridge_preparing'),
            cancellable: false
        }, () => preparation);
    }

    private async findRunningIsolatedProfiles(): Promise<RunningIsolatedProfile[]> {
        const configuredProfileRoot = vscode.workspace
            .getConfiguration('webcodeGateway')
            .get<string>('isolatedBrowser.profileRoot');
        const profiles = BROWSER_FAMILIES.map(browserFamily => {
            const result = resolveIsolatedBrowserProfilePaths({
                browserFamily,
                legacyStorageRoot: this.context.globalStorageUri.fsPath,
                configuredProfileRoot
            });
            if (result.status === 'invalid-profile-root') {
                throw new Error(t('isolated_profile_root_invalid', {
                    path: result.configuredProfileRoot
                }));
            }
            return result.paths;
        });

        const runningProfiles = await Promise.all(profiles.map(async profile => ({
            browserFamily: profile.browserFamily,
            profileDir: profile.profileDir,
            processIds: await getBrowserProfileProcessIds(profile.browserFamily, profile.profileDir)
        })));
        return runningProfiles.filter(profile => profile.processIds.length > 0);
    }

    private async confirmAndStopRunningProfiles(profiles: RunningIsolatedProfile[]): Promise<boolean> {
        const browserNames = [...new Set(profiles.map(profile => getBrowserDisplayName(profile.browserFamily)))].join(' / ');
        const restartButton = t('browser_bridge_restart_button');
        const selection = await vscode.window.showWarningMessage(
            t('browser_bridge_restart_required', { browsers: browserNames }),
            { modal: true },
            restartButton
        );
        if (selection !== restartButton) {
            return false;
        }

        const results = await Promise.all(profiles.map(profile => stopBrowserProfileProcesses(
            profile.browserFamily,
            profile.profileDir
        ).catch(() => false)));
        if (results.every(Boolean)) {
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

function resolveBrowserExtensionRoot(): string {
    const override = process.env.WEBCODE_BROWSER_EXTENSION_ROOT?.trim();
    if (override) {
        if (!path.isAbsolute(override)) {
            throw new Error(`WEBCODE_BROWSER_EXTENSION_ROOT must be absolute: ${override}`);
        }
        return path.resolve(override);
    }
    return resolveDefaultBrowserExtensionRoot(os.platform());
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

function getBrowserDisplayName(browserFamily: BrowserFamily): string {
    return browserFamily === 'edge' ? 'Microsoft Edge' : 'Chrome';
}
