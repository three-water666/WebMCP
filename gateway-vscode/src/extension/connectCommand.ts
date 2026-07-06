import * as vscode from 'vscode';

import { t } from '../i18n';
import { getConfiguredAiSites } from '../platforms';
import { launchBridge, launchIsolatedEdgeProfile } from './browserLauncher';
import {
    CLEAN_LEGACY_ISOLATED_BROWSER_PROFILES_COMMAND,
    hasCurrentIsolatedBrowserProfileData,
    hasLegacyIsolatedBrowserProfileData,
    openIsolatedProfileLocation,
    RESET_ISOLATED_BROWSER_PROFILES_COMMAND
} from './isolatedProfileCleanupCommand';
import type { GatewayServiceController } from './serviceController';
import type { AISiteConfig, CustomActionItem, ResolvedAiSiteConfig } from './types';

interface RegisterGatewayConnectCommandOptions {
    context: vscode.ExtensionContext;
    outputChannel: vscode.OutputChannel;
    serviceController: GatewayServiceController;
}

interface OnlineMenuContext {
    extensionContext: vscode.ExtensionContext;
    currentPort: number;
    currentToken: string;
    outputChannel: vscode.OutputChannel;
    serviceController: GatewayServiceController;
}

const OPEN_PROFILE_FOLDER_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('folder-opened'),
    tooltip: t('isolated_profiles_open_folder_button')
};

export function registerGatewayConnectCommand(options: RegisterGatewayConnectCommandOptions): void {
    options.context.subscriptions.push(vscode.commands.registerCommand('webcode-gateway.connect', async () => {
        await handleGatewayConnectCommand(options.context, options.outputChannel, options.serviceController);
    }));
}

async function handleGatewayConnectCommand(
    extensionContext: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    serviceController: GatewayServiceController
): Promise<void> {
    const state = serviceController.getState();

    // 1. Case: Starting -> Show Logs
    if (state.isStarting) {
        outputChannel.show();
        return;
    }

    // 2. Case: Offline -> Show Start Option
    if (!state.isRunning) {
        await showOfflineMenu(extensionContext, outputChannel, serviceController);
        return;
    }

    // 3. Case: Online -> Show Full Menu
    if (!state.currentPort || !state.currentToken) {
        // Should not happen if isRunning is true, but safe guard
        serviceController.markOffline();
        return;
    }

    await showOnlineMenu({
        extensionContext,
        currentPort: state.currentPort,
        currentToken: state.currentToken,
        outputChannel,
        serviceController
    });
}

async function showOfflineMenu(
    extensionContext: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    serviceController: GatewayServiceController
): Promise<void> {
    const cleanupItems = await buildIsolatedProfileCleanupItems(extensionContext);
    const items: CustomActionItem[] = [
        { label: t('offline_start_label'), description: t('offline_start_desc'), action: 'start' },
        createOpenIsolatedEdgeProfileItem(),
        ...cleanupItems,
        { label: t('view_logs_label'), description: t('view_logs_desc'), action: 'showLogs' },
        { label: t('configure_label'), description: t('configure_desc'), action: 'settings' }
    ];

    const selection = await showGatewayQuickPick(extensionContext, items, {
        placeHolder: t('offline_placeholder'),
        title: t('manager_title')
    });

    if (!selection) {
        return;
    }

    if (selection.action === 'start') {
        await serviceController.start();
        const newState = serviceController.getState();
        if (newState.currentPort && newState.currentToken && newState.isRunning) {
            await showOnlineMenu({
                extensionContext,
                currentPort: newState.currentPort,
                currentToken: newState.currentToken,
                outputChannel,
                serviceController
            });
        }
    } else if (selection.action === 'openIsolatedEdgeProfile') {
        launchIsolatedEdgeProfile(extensionContext, outputChannel);
    } else if (selection.action === 'resetIsolatedProfiles') {
        await vscode.commands.executeCommand(RESET_ISOLATED_BROWSER_PROFILES_COMMAND);
    } else if (selection.action === 'cleanLegacyIsolatedProfiles') {
        await vscode.commands.executeCommand(CLEAN_LEGACY_ISOLATED_BROWSER_PROFILES_COMMAND);
    } else if (selection.action === 'showLogs') {
        outputChannel.show();
    } else if (selection.action === 'settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'webcodeGateway');
    }
}

async function showOnlineMenu(context: OnlineMenuContext): Promise<void> {
    // 1. 从配置中读取 AI 站点列表
    const config = vscode.workspace.getConfiguration('webcodeGateway');
    const aiSites = getConfiguredAiSites(config.get<AISiteConfig[]>('aiSites'));
    const items = await buildOnlineMenuItems(aiSites, context.extensionContext);

    const selection = await showGatewayQuickPick(context.extensionContext, items, {
        placeHolder: t('online_placeholder'),
        title: t('online_title', { port: context.currentPort })
    });

    if (!selection) {
        return;
    }

    await handleOnlineSelection(selection, aiSites, context);
}

function showGatewayQuickPick(
    extensionContext: vscode.ExtensionContext,
    items: CustomActionItem[],
    options: vscode.QuickPickOptions
): Promise<CustomActionItem | undefined> {
    return new Promise(resolve => {
        const quickPick = vscode.window.createQuickPick<CustomActionItem>();
        let settled = false;

        quickPick.items = items;
        quickPick.title = options.title;
        quickPick.placeholder = options.placeHolder;

        quickPick.onDidAccept(() => {
            settle(quickPick.selectedItems[0]);
        });
        quickPick.onDidHide(() => {
            settle(undefined);
        });
        quickPick.onDidTriggerItemButton(event => {
            if (!event.item.profileCleanupTarget) {
                return;
            }

            void openIsolatedProfileLocation(extensionContext, event.item.profileCleanupTarget);
        });

        quickPick.show();

        function settle(selection: CustomActionItem | undefined): void {
            if (settled) {
                return;
            }

            settled = true;
            quickPick.dispose();
            resolve(selection);
        }
    });
}

async function buildOnlineMenuItems(
    aiSites: ResolvedAiSiteConfig[],
    extensionContext: vscode.ExtensionContext
): Promise<CustomActionItem[]> {
    // 2. 动态生成快速启动项 (仅显示 showQuickLaunch 为 true 的项)
    const quickLaunchItems: CustomActionItem[] = aiSites
        .filter(site => site.showQuickLaunch === true)
        .map(site => ({
            label: t('open_label', { name: site.name }),
            description: site.address.replace(/^https?:\/\//, ''),
            siteId: site.id,
            target: site.address,
        }));

    // 3. 准备完整的 QuickPick 列表
    const cleanupItems = await buildIsolatedProfileCleanupItems(extensionContext);

    return [
        ...quickLaunchItems,
        createOpenIsolatedEdgeProfileItem(),
        { label: t('custom_launch_label'), description: t('custom_launch_desc'), action: 'custom' },
        ...cleanupItems,
        { label: t('view_logs_label'), description: t('view_gateway_logs_desc'), action: 'showLogs' },
        { label: t('configure_gateway_label'), description: t('configure_gateway_desc'), action: 'settings' },
        { label: t('restart_label'), description: t('restart_desc'), action: 'restart' },
        { label: t('stop_label'), description: t('stop_desc'), action: 'stop' }
    ];
}

async function handleOnlineSelection(
    selection: CustomActionItem,
    aiSites: ResolvedAiSiteConfig[],
    context: OnlineMenuContext
): Promise<void> {
    // 0. 查看日志
    if (selection.action === 'showLogs') {
        context.outputChannel.show();
        return;
    }

    // 1. 设置
    if (selection.action === 'settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'webcodeGateway');
        return;
    }

    // 2. 重启
    if (selection.action === 'restart') {
        await context.serviceController.restart();
        return;
    }

    // 2.5 停止
    if (selection.action === 'stop') {
        await context.serviceController.stop();
        return;
    }

    // 3. 自定义启动
    if (selection.action === 'custom') {
        await launchCustomBridge(
            aiSites,
            context.extensionContext,
            context.outputChannel,
            context.currentPort,
            context.currentToken
        );
        return;
    }

    // 3.5 直接打开默认 Edge 独立 profile，便于登录或管理浏览器插件。
    if (selection.action === 'openIsolatedEdgeProfile') {
        launchIsolatedEdgeProfile(context.extensionContext, context.outputChannel);
        return;
    }

    if (selection.action === 'resetIsolatedProfiles') {
        await vscode.commands.executeCommand(RESET_ISOLATED_BROWSER_PROFILES_COMMAND);
        return;
    }

    if (selection.action === 'cleanLegacyIsolatedProfiles') {
        await vscode.commands.executeCommand(CLEAN_LEGACY_ISOLATED_BROWSER_PROFILES_COMMAND);
        return;
    }

    // 4. 默认启动 (智能匹配配置)
    if (selection.target) {
        launchBridge({
            context: context.extensionContext,
            outputChannel: context.outputChannel,
            siteId: selection.siteId ?? '',
            targetUrl: selection.target,
            browserMode: 'auto',
            currentPort: context.currentPort,
            currentToken: context.currentToken
        });
    }
}

async function launchCustomBridge(
    aiSites: ResolvedAiSiteConfig[],
    extensionContext: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    currentPort: number,
    currentToken: string
): Promise<void> {
    // Custom Launch 现在使用所有配置的 AI 站点，无论 showQuickLaunch 是否为 true
    const aiOptionsForCustomLaunch: CustomActionItem[] = aiSites.map(site => ({
        label: `$(globe) ${site.name}`,
        description: site.address,
        siteId: site.id,
        target: site.address,
    }));

    const aiSelection = await vscode.window.showQuickPick<CustomActionItem>(aiOptionsForCustomLaunch, {
        placeHolder: t('custom_step1')
    });
    if (!aiSelection) {
        return;
    }

    const browserOptions: CustomActionItem[] = [
        { label: t('browser_group_edge'), kind: vscode.QuickPickItemKind.Separator },
        {
            label: t('browser_isolated_edge'),
            description: t('browser_recommended'),
            detail: t('browser_isolated_desc'),
            value: 'isolated-edge'
        },
        { label: t('browser_user_profile_edge'), description: t('browser_user_profile_desc'), value: 'user-profile-edge' },
        { label: t('browser_edge'), value: 'edge' },
        { label: t('browser_group_chrome'), kind: vscode.QuickPickItemKind.Separator },
        { label: t('browser_isolated_chrome'), description: t('browser_isolated_desc'), value: 'isolated-chrome' },
        { label: t('browser_user_profile_chrome'), description: t('browser_user_profile_desc'), value: 'user-profile-chrome' },
        { label: t('browser_chrome'), value: 'chrome' },
        { label: t('browser_group_system'), kind: vscode.QuickPickItemKind.Separator },
        { label: t('browser_default'), value: 'default' }
    ];
    const browserSelection = await vscode.window.showQuickPick<CustomActionItem>(browserOptions, {
        placeHolder: t('custom_step2', { name: aiSelection.label.replace('$(globe) ', '') })
    });
    if (!browserSelection) {
        return;
    }

    launchBridge({
        context: extensionContext,
        outputChannel,
        siteId: aiSelection.siteId ?? "",
        targetUrl: aiSelection.target ?? "",
        browserMode: browserSelection.value ?? "",
        currentPort,
        currentToken
    });
}

function createOpenIsolatedEdgeProfileItem(): CustomActionItem {
    return {
        label: t('open_isolated_edge_profile_label'),
        description: t('open_isolated_edge_profile_desc'),
        action: 'openIsolatedEdgeProfile'
    };
}

function createResetIsolatedProfilesItem(): CustomActionItem {
    return {
        label: t('reset_isolated_profiles_label'),
        description: t('reset_isolated_profiles_desc'),
        action: 'resetIsolatedProfiles',
        profileCleanupTarget: 'current',
        buttons: [OPEN_PROFILE_FOLDER_BUTTON]
    };
}

async function buildIsolatedProfileCleanupItems(context: vscode.ExtensionContext): Promise<CustomActionItem[]> {
    const items: CustomActionItem[] = [];
    if (await hasCurrentIsolatedBrowserProfileData(context)) {
        items.push(createResetIsolatedProfilesItem());
    }

    if (await hasLegacyIsolatedBrowserProfileData(context)) {
        items.push(createCleanLegacyIsolatedProfilesItem());
    }

    return items;
}

function createCleanLegacyIsolatedProfilesItem(): CustomActionItem {
    return {
        label: t('clean_legacy_isolated_profiles_label'),
        description: t('clean_legacy_isolated_profiles_desc'),
        action: 'cleanLegacyIsolatedProfiles',
        profileCleanupTarget: 'legacy',
        buttons: [OPEN_PROFILE_FOLDER_BUTTON]
    };
}
