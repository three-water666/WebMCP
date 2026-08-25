import * as vscode from 'vscode';

import type { GatewayManager } from '../gateway';
import type { GatewayServiceController } from './serviceController';
import type { SkillWatcherController } from './skillWatchers';

interface RegisterGatewayConfigurationWatcherOptions {
    context: vscode.ExtensionContext;
    manager: GatewayManager;
    outputChannel: vscode.OutputChannel;
    serviceController: GatewayServiceController;
    skillWatcherController: SkillWatcherController;
}

export function registerGatewayConfigurationWatcher(options: RegisterGatewayConfigurationWatcherOptions): void {
    options.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!isGatewayServerConfigurationChange(event)) {
            return;
        }

        if (event.affectsConfiguration('webcodeGateway.skillDirectories')) {
            options.skillWatcherController.refresh();
            options.manager.invalidateSkillCache('skillDirectories configuration changed');
        }

        if (options.serviceController.getState().isRunning) {
            options.outputChannel.appendLine("⚙️ Server configuration changed, restarting...");
            await options.serviceController.start();
        }
    }));
}

function isGatewayServerConfigurationChange(event: vscode.ConfigurationChangeEvent): boolean {
    return event.affectsConfiguration('webcodeGateway.port') ||
        event.affectsConfiguration('webcodeGateway.servers') ||
        event.affectsConfiguration('webcodeGateway.skillDirectories') ||
        event.affectsConfiguration('webcodeGateway.commandShell.path') ||
        event.affectsConfiguration('webcodeGateway.command.allowedRoots');
}
