import express from 'express';
import * as crypto from 'crypto';
import type { Server as HttpServer } from 'http';
import * as vscode from 'vscode';

import { getErrorMessage } from './gateway/errorUtils';
import { SkillManager } from './skillManager';
import { SessionRuntime } from './session/sessionRuntime';
import { TerminalSessionManager } from './terminalSessionManager';
import {
    createLocalToolMap,
    type LocalTool,
    type ToolDefinitionContext,
    type ToolDefinition,
    type ToolExecutionContext
} from './tools';
import { registerBridgeRoute } from './gateway/bridgeRoute';
import { registerConfigRoutes } from './gateway/initRoutes';
import {
    createAuthMiddleware,
    createCorsMiddleware,
    createRequestLoggerMiddleware
} from './gateway/middleware';
import { connectToConfiguredServers } from './gateway/serverConnector';
import { createToolCallHandler } from './gateway/toolCallRoute';
import { generateGroupedTools } from './gateway/toolGroups';
import type {
    ConnectedClient,
    GatewayConfig,
    RemoteToolRoute,
    ServerConfig,
    StartResult
} from './gateway/types';

export class GatewayManager {
    private app: express.Express | null = null;
    private server: HttpServer | null = null;
    private toolRouter = new Map<string, RemoteToolRoute>();
    private connectedClients: ConnectedClient[] = [];
    private localTools: Map<string, LocalTool> = createLocalToolMap();
    private outputChannel: vscode.OutputChannel;
    private extensionPath: string;
    private context: vscode.ExtensionContext;
    private authToken: string = '';
    private watchdogTimer: NodeJS.Timeout | null = null;
    private readonly WATCHDOG_TIMEOUT = 12 * 60 * 60 * 1000; // 12 hours
    private onAutoStop: (() => void) | null = null;
    private skillManager: SkillManager;
    private terminalSessionManager: TerminalSessionManager;
    private readonly sessionRuntime = new SessionRuntime();
    private skillDirectories: string[] = [];
    private commandShellPath: string | undefined;

    constructor(outputChannel: vscode.OutputChannel, extensionPath: string, context: vscode.ExtensionContext, onAutoStop?: () => void) {
        this.outputChannel = outputChannel;
        this.extensionPath = extensionPath;
        this.context = context;
        this.onAutoStop = onAutoStop ?? null;
        this.skillManager = new SkillManager(outputChannel, extensionPath, () => vscode.workspace.workspaceFolders);
        this.terminalSessionManager = new TerminalSessionManager(outputChannel);
        // [Persistence] Generate token once per VS Code session
        this.authToken = crypto.randomUUID();
    }

    private _generateGroupedTools() {
        return generateGroupedTools(this.toolRouter, this.localTools, tool => this.getLocalToolDefinition(tool));
    }

    private getToolDefinition(name: string): ToolDefinition | null {
        const localTool = this.localTools.get(name);
        if (localTool) {
            return this.getLocalToolDefinition(localTool);
        }

        return this.toolRouter.get(name)?.definition ?? null;
    }

    private getLocalToolDefinition(tool: LocalTool): ToolDefinition {
        return tool.getDefinition?.(this.createToolDefinitionContext()) ?? tool.definition;
    }

    private createToolDefinitionContext(): ToolDefinitionContext {
        return {
            commandShellPath: this.commandShellPath
        };
    }

    private resetWatchdog() {
        if (this.watchdogTimer) {clearTimeout(this.watchdogTimer);}
        this.watchdogTimer = setTimeout(() => {
            this.log('💤 No activity for 30 minutes. Shutting down...');
            void this.stop();
            if (this.onAutoStop) {this.onAutoStop();}
        }, this.WATCHDOG_TIMEOUT);
    }

    private log(message: string) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        this.outputChannel.appendLine(`[${time}] ${message}`);
    }

    private error(message: string, err?: unknown) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        this.outputChannel.appendLine(`[${time}] ❌ ${message} ${getErrorMessage(err)}`);
    }

    invalidateSkillCache(reason?: string) {
        this.skillManager.invalidateCache(reason);
    }

    private getPrimaryWorkspaceRoot(): string | null {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    }

    private createToolExecutionContext(): ToolExecutionContext {
        return {
            metricsCollector: this.sessionRuntime.metricsCollector,
            checkpointState: this.sessionRuntime.checkpointState,
            workspaceRoot: this.getPrimaryWorkspaceRoot(),
            outputChannel: this.outputChannel,
            skillManager: this.skillManager,
            terminalSessionManager: this.terminalSessionManager,
            skillDirectories: this.skillDirectories,
            commandShellPath: this.commandShellPath,
            listTools: () => this._generateGroupedTools(),
            getToolDefinition: (name: string) => this.getToolDefinition(name)
        };
    }

    async connectToServers(servers: Record<string, ServerConfig>) {
        this.connectedClients = await connectToConfiguredServers({
            connectedClients: this.connectedClients,
            extensionPath: this.extensionPath,
            log: this.log.bind(this),
            error: this.error.bind(this),
            servers,
            toolRouter: this.toolRouter,
            workspaceRoot: this.getPrimaryWorkspaceRoot()
        });
    }

    private registerRoutes(config: GatewayConfig): void {
        if (!this.app) {return;}

        this.app.use(createCorsMiddleware(config, this.log.bind(this)));
        this.app.use(createRequestLoggerMiddleware(
            () => this.resetWatchdog(),
            this.log.bind(this),
            { skipWatchdogPaths: ['/v1/status'] }
        ));
        this.app.use(createAuthMiddleware(() => this.authToken, this.log.bind(this)));

        registerConfigRoutes(
            this.app,
            config,
            this.log.bind(this),
            () => this.sessionRuntime.getHealth()
        );
        registerBridgeRoute(this.app, {
            getPort: () => this.getServerPort(),
            getAiSites: () => config.aiSites ?? [],
            getAuthToken: () => this.authToken,
            getExtensionVersion: () => this.getExtensionVersion(),
            getWorkspaceRoot: () => this.getPrimaryWorkspaceRoot(),
            log: this.log.bind(this)
        });

        this.app.post('/v1/tools/call', createToolCallHandler({
            createToolExecutionContext: () => this.createToolExecutionContext(),
            error: this.error.bind(this),
            getToolDefinition: (name: string) => this.getToolDefinition(name),
            getWorkspaceRoot: () => this.getPrimaryWorkspaceRoot(),
            localTools: this.localTools,
            log: this.log.bind(this),
            toolRouter: this.toolRouter,
            metricsCollector: this.sessionRuntime.metricsCollector,
            sessionRuntime: this.sessionRuntime
        }));
    }

    private getServerPort(): number {
        const address = this.server?.address();
        if (!address || typeof address === 'string') {
            throw new Error('Gateway server is not listening on a TCP port.');
        }
        return address.port;
    }

    private getExtensionVersion(): string {
        const version = (this.context.extension.packageJSON as { version?: unknown }).version;
        return typeof version === 'string' && version.trim() ? version : 'unknown';
    }

    async start(config: GatewayConfig): Promise<StartResult> {
        if (this.server) {
            await this.stop();
        }
        this.skillDirectories = config.skillDirectories ?? [];
        const commandShellPath = config.commandShellPath?.trim();
        this.commandShellPath = commandShellPath === '' ? undefined : commandShellPath;
        await this.connectToServers(config.mcpServers);

        // 1. 使用持久化 Token (仅首次生成)
        if (!this.authToken) {this.authToken = crypto.randomUUID();}
        // this.log(`🔐 Security Token: ${this.authToken}`); // Reduce noise on restart

        // Start Watchdog
        this.resetWatchdog();

        this.app = express();
        this.app.use(express.json());
        this.registerRoutes(config);

        return this.listenOnAvailablePort(config);
    }

    private listenOnAvailablePort(config: GatewayConfig): Promise<StartResult> {
        return new Promise<StartResult>((resolve, reject) => {
            const tryListen = (currentPort: number, attempt: number) => {
                const maxRetries = 20;
                if (attempt > maxRetries) {
                    reject(new Error("No ports available"));
                    return;
                }

                if (!this.app) {return;}
                this.server = this.app.listen(currentPort, '127.0.0.1', () => {
                    this.log(`🌐 Gateway running on http://127.0.0.1:${currentPort} (Token: ${this.authToken.slice(0, 8)}...)`);
                    vscode.window.setStatusBarMessage(`MCP Gateway: On (${currentPort})`, 5000);
                    resolve({ port: currentPort, token: this.authToken });
                });

                this.server.on('error', (e: NodeJS.ErrnoException) => {
                    if (e.code === 'EADDRINUSE') {
                        // Fix: Prevent infinite loop if preferredPort equals config.port
                        if (config.preferredPort && currentPort === config.preferredPort && currentPort !== config.port) {
                            this.log(`⚠️ Preferred port ${currentPort} busy. Falling back to default range.`);
                            tryListen(config.port, 0);
                        } else {
                            tryListen(currentPort + 1, attempt + 1);
                        }
                    } else {
                        reject(e);
                    }
                });
            };

            if (config.preferredPort && config.preferredPort !== config.port) {
                tryListen(config.preferredPort, 0);
            } else {
                tryListen(config.port, 0);
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async stop() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
        if (this.server) {
            this.server.close();
            this.server = null;
            // [Persistence] Do NOT clear authToken here
            this.log('🛑 Gateway server stopped.');
        }
        this.connectedClients.forEach(c => {
            try {
                void c.client.close();
            } catch { }
        });
        this.connectedClients = [];
    }
}
