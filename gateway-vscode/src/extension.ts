import * as vscode from 'vscode';

import { registerGatewayConfigurationWatcher } from './extension/configurationWatcher';
import { buildBridgeUrl } from './extension/bridgeUrl';
import { registerGatewayConnectCommand } from './extension/connectCommand';
import { registerCopyContextCommand } from './extension/copyContextCommand';
import { registerIsolatedProfileCleanupCommand } from './extension/isolatedProfileCleanupCommand';
import {
    createGatewayServiceController,
    type GatewayServiceController
} from './extension/serviceController';
import { createSkillWatcherController } from './extension/skillWatchers';
import { updateGatewayStatusBar } from './extension/statusBar';
import { GatewayManager } from './gateway';
import { createGatewayRuntimeTraceSinkFromEnvironment } from './gateway/runtimeTrace';
import { t } from './i18n';
import {
    findAiSiteById,
    getConfiguredAiSites,
    type AISiteConfig,
    type ResolvedAiSiteConfig
} from './platforms';

interface RuntimeHolder {
    serviceController?: GatewayServiceController;
}

export interface GatewayExtensionState {
    currentPort: number | null;
    isStarting: boolean;
    isRunning: boolean;
}

export interface GatewayExtensionApi {
    getGatewayState(): GatewayExtensionState;
    evaluation?: {
        getSiteConfiguration(siteId: string): ResolvedAiSiteConfig;
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

/**
 * VS Code 扩展激活入口。
 *
 * 这个文件只负责把扩展启动时需要的对象串起来，不直接承载具体业务逻辑：
 * - GatewayManager 负责本地 HTTP/MCP 网关的生命周期和路由。
 * - GatewayServiceController 负责 VS Code 侧的启动、停止、重启状态管理。
 * - 各个 register* 函数负责注册命令、配置监听和编辑器交互。
 *
 * 保持入口层只做编排，可以让后续修复命令菜单、服务状态或技能监听时，
 * 直接进入对应模块，而不是继续把逻辑堆到 extension.ts 里。
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function activate(context: vscode.ExtensionContext): Promise<GatewayExtensionApi> {
    // 创建扩展专用输出通道。GatewayManager、服务控制器和命令菜单都会复用它，
    // 这样启动日志、重启日志、错误信息都集中显示在同一个 VS Code Output 面板里。
    const outputChannel = vscode.window.createOutputChannel(t('output_channel_name'));
    // outputChannel.show(true); // 静默启动，不自动弹出面板
    outputChannel.appendLine("🚀 MCP Gateway Extension Activating...");

    // GatewayManager 构造时需要传入自动停止回调；但 serviceController 要等
    // manager 创建后才能创建。这个 holder 用来打破初始化顺序上的循环引用，
    // 让自动停止回调触发时仍然能通知 VS Code 状态栏和内部运行状态。
    const runtime: RuntimeHolder = {};

    // 创建本地网关管理器。它持有 Express 服务、MCP server 连接、本地工具、
    // 技能缓存、终端会话等核心运行时能力；extension.ts 只保留它的实例引用，
    // 具体启动参数由 serviceController 在用户点击启动或配置变更重启时组装。
    const manager = new GatewayManager(
        outputChannel,
        context.extensionPath,
        context,
        idleTimeoutMs => {
            runtime.serviceController?.markAutoStopped(idleTimeoutMs);
        },
        createGatewayRuntimeTraceSinkFromEnvironment()
    );

    // 创建技能目录监听控制器，并在激活时立即按当前 workspace/config 扫一遍。
    // watcher 只负责在 SKILL.md 或技能目录内容变化时通知 manager 失效缓存，
    // 真正的技能读取和缓存逻辑仍然留在 GatewayManager/SkillManager 内部。
    const skillWatcherController = createSkillWatcherController(context, manager);
    skillWatcherController.refresh();

    // workspace folder 变化会改变可扫描的技能目录集合，所以这里重新创建 watcher。
    // 同时主动失效技能缓存，避免用户切换/新增 workspace 后仍拿到旧目录的技能。
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        skillWatcherController.refresh();
        manager.invalidateSkillCache('workspace folders changed');
    }));

    // 创建右下角状态栏入口。它既展示网关状态，也作为用户打开网关菜单的入口。
    // 具体显示文案和颜色由 statusBar 模块根据 offline/starting/online 状态统一处理。
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'webcode-gateway.connect';
    context.subscriptions.push(statusBarItem);

    // 创建 VS Code 侧服务控制器。它把“启动网关需要读取哪些配置、保存端口、
    // 更新状态栏、展示启动失败/停止/重启消息”封装起来，命令菜单和配置监听
    // 都通过这个对象控制服务，避免各处直接修改 currentPort/isRunning。
    const serviceController = createGatewayServiceController({
        manager,
        context,
        outputChannel,
        statusBarItem
    });

    // 把 controller 写回 holder，补上 GatewayManager 自动停止回调需要的引用。
    // 从这一行之后，manager 的 watchdog 触发自动关闭时可以正确同步 VS Code UI 状态。
    runtime.serviceController = serviceController;

    // 注册编辑器右键菜单命令：复制当前选中文本，并在剪贴板里附带相对文件路径。
    // 该命令和网关服务本身没有运行依赖，所以激活时直接注册。
    registerCopyContextCommand(context);
    registerIsolatedProfileCleanupCommand(context);

    // 注册状态栏点击后的主菜单命令。菜单会根据 serviceController 当前状态切换：
    // starting 时显示日志，offline 时提供启动/日志/设置，online 时提供打开站点、
    // 自定义浏览器启动、重启、停止等操作。
    registerGatewayConnectCommand({
        context,
        outputChannel,
        serviceController
    });

    // 注册 webcodeGateway 配置监听。端口、MCP server、技能目录变化时，
    // 如果服务正在运行就走 serviceController 重启；技能目录变化还会刷新 watcher
    // 并失效技能缓存，保证后续工具列表能反映最新配置。
    registerGatewayConfigurationWatcher({
        context,
        manager,
        outputChannel,
        serviceController,
        skillWatcherController
    });

    // 激活完成后只把状态栏初始化为离线状态，不自动启动本地网关。
    // 这样 VS Code 启动扩展时不会立刻占用端口或拉起 MCP server；
    // 用户点击状态栏选择启动后，才由 serviceController.start() 真正启动服务。
    updateGatewayStatusBar(statusBarItem, false, undefined, false);
    // Do not auto-start

    const api: GatewayExtensionApi = {
        getGatewayState() {
            const { currentPort, isStarting, isRunning } = serviceController.getState();
            return { currentPort, isStarting, isRunning };
        }
    };

    if (process.env.WEBCODE_EVAL_MODE === '1') {
        api.evaluation = {
            getSiteConfiguration(siteId: string): ResolvedAiSiteConfig {
                const configured = vscode.workspace
                    .getConfiguration('webcodeGateway')
                    .get<AISiteConfig[]>('aiSites');
                const site = findAiSiteById(getConfiguredAiSites(configured), siteId);
                if (!site) {
                    throw new Error(`Evaluation site is not configured: ${siteId}`);
                }
                return site;
            },
            async startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string> {
                await serviceController.start();
                const state = serviceController.getState();
                if (!state.isRunning || !state.currentPort) {
                    throw new Error('Evaluation Gateway failed to start.');
                }
                const bridgeCode = serviceController.issueBridgeCode(siteId, targetUrl);
                return buildBridgeUrl(state.currentPort, bridgeCode);
            },
            async stop(): Promise<void> {
                await serviceController.stop();
            }
        };
    }

    return api;
}
