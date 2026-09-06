import * as vscode from 'vscode';

import type { GatewayManager } from '../gateway';
import { t } from '../i18n';
import { getConfiguredAiSites } from '../platforms';
import { filterCustomServers, type BuiltinServerConfig } from './customServers';
import { getErrorMessage } from './errorUtils';
import { updateGatewayStatusBar } from './statusBar';
import type { AISiteConfig, ResolvedAiSiteConfig } from './types';
import { resolveCommandAllowedRoots } from './commandAllowedRoots';
import { resolveIdleTimeoutMs } from '../gateway/idleTimeout';

export interface GatewayServiceSnapshot {
    currentPort: number | null;
    isStarting: boolean;
    isRunning: boolean;
}

export interface GatewayServiceController {
    start(): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    issueBridgeCode(siteId: string, targetUrl: string): string;
    markAutoStopped(idleTimeoutMs: number): void;
    markOffline(): void;
    getState(): GatewayServiceSnapshot;
}

interface CreateGatewayServiceControllerOptions {
    manager: GatewayManager;
    context: vscode.ExtensionContext;
    outputChannel: vscode.OutputChannel;
    statusBarItem: vscode.StatusBarItem;
}

export function createGatewayServiceController(options: CreateGatewayServiceControllerOptions): GatewayServiceController {
    let currentPort: number | null = null;
    let isStarting = false;
    let isRunning = false;
    const getState = () => ({ currentPort, isStarting, isRunning });
    const issueBridgeCode = createBridgeCodeIssuer(options.manager, getState);

    const start = async () => {
        if (!hasWorkspaceFolder()) {
            if (isRunning || isStarting) {
                await options.manager.stop();
            }
            currentPort = null;
            isStarting = false;
            isRunning = false;
            updateGatewayStatusBar(options.statusBarItem, false);
            void vscode.window.showErrorMessage(t('start_requires_workspace'));
            return;
        }

        // Set Loading State
        isStarting = true;
        updateGatewayStatusBar(options.statusBarItem, true, undefined, true);

        const config = vscode.workspace.getConfiguration('webcodeGateway');
        const portConfig = config.get<number>('port') ?? 34567;
        const idleTimeoutMs = resolveIdleTimeoutMs(config.get<number>('idleTimeoutMinutes'));
        const commandConfig = getCommandExecutionConfig(config, options.outputChannel);
        const customServers = filterCustomServers(
            config.get<Record<string, BuiltinServerConfig>>('servers') ?? {},
            options.outputChannel
        );
        const skillDirectories = config.get<string[]>('skillDirectories') ?? [];
        const lastUsedPort = options.context.workspaceState.get<number>('mcp.lastPort');

        // [Security] Extract Allowed Origins from AI Sites config
        const aiSites = getConfiguredAiSites(config.get<AISiteConfig[]>('aiSites'));
        const allowedOrigins = buildAllowedOrigins(aiSites);

        try {
            const result = await options.manager.start({
                port: portConfig,
                idleTimeoutMs,
                preferredPort: lastUsedPort,
                mcpServers: customServers,
                allowedOrigins,
                aiSites,
                skillDirectories,
                ...commandConfig
            });

            currentPort = result.port;
            if (currentPort !== lastUsedPort) {
                await options.context.workspaceState.update('mcp.lastPort', currentPort);
            }

            isStarting = false;
            isRunning = true;
            updateGatewayStatusBar(options.statusBarItem, true, currentPort);
        } catch (error: unknown) {
            void vscode.window.showErrorMessage(t('start_failed', { message: getErrorMessage(error) }));
            isStarting = false;
            isRunning = false;
            currentPort = null;
            updateGatewayStatusBar(options.statusBarItem, false);
        }
    };

    const markOffline = () => {
        isRunning = false;
        currentPort = null;
        updateGatewayStatusBar(options.statusBarItem, false);
    };

    const stop = async () => {
        await options.manager.stop();
        markOffline();
        void vscode.window.showInformationMessage(t('server_stopped'));
    };

    const restart = async () => {
        options.outputChannel.appendLine("🔄 Manual restart triggered.");
        await options.manager.stop();
        await start();
        void vscode.window.showInformationMessage(t('server_restarted'));
    };

    const markAutoStopped = (idleTimeoutMs: number) => {
        markOffline();
        const minutes = Math.round(idleTimeoutMs / (60 * 1000));
        void vscode.window.showInformationMessage(t('auto_stop_message', { minutes }));
        options.outputChannel.appendLine("💤 Auto-shutdown triggered due to inactivity.");
    };

    return {
        start,
        stop,
        restart,
        issueBridgeCode,
        markAutoStopped,
        markOffline,
        getState
    };
}

function createBridgeCodeIssuer(
    manager: GatewayManager,
    getState: () => GatewayServiceSnapshot
): (siteId: string, targetUrl: string) => string {
    return (siteId, targetUrl) => {
        const state = getState();
        if (!state.isRunning || !state.currentPort) {
            throw new Error('Gateway server is not running.');
        }
        return manager.issueBridgeCode(siteId, targetUrl);
    };
}

function getCommandShellPath(config: vscode.WorkspaceConfiguration): string | undefined {
    const configuredCommandShellPath = config.get<string>('commandShell.path')?.trim();
    return configuredCommandShellPath === '' ? undefined : configuredCommandShellPath;
}

function getCommandExecutionConfig(
    config: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
): { commandAllowedRoots: string[]; commandShellPath?: string } {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return {
        commandShellPath: getCommandShellPath(config),
        commandAllowedRoots: resolveCommandAllowedRoots(
            config.get<string[]>('command.allowedRoots') ?? [],
            workspaceRoot,
            outputChannel
        )
    };
}

function hasWorkspaceFolder(): boolean {
    return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function buildAllowedOrigins(aiSites: ResolvedAiSiteConfig[]): string[] {
    return aiSites.map(site => {
        try {
            return new URL(site.address).origin;
        } catch {
            return '';
        }
    }).filter(origin => origin !== '');
}

