import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { startInteractiveQaControl } from './interactiveQaControl';

interface EvaluationExtensionApi {
    getGatewayState(): {
        currentPort: number | null;
        isStarting: boolean;
        isRunning: boolean;
    };
    evaluation?: {
        getSiteConfiguration(siteId: string): {
            address: string;
            id: string;
            name: string;
        };
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

const EXTENSION_ID = 'three-water666.gateway-vscode';

suite('Interactive QA Extension Host', () => {
    test('serves the agent-led QA control channel until stopped', async function () {
        this.timeout(24 * 60 * 60 * 1000);
        const runDirectory = requireEnvironmentPath('WEBCODE_EVAL_RUN_DIR');
        const token = requireEnvironmentPath('WEBCODE_QA_CONTROL_TOKEN');
        const gatewayPort = Number(requireEnvironmentPath('WEBCODE_QA_GATEWAY_PORT'));
        assert.ok(Number.isInteger(gatewayPort), 'The QA Gateway port must be an integer.');

        const configuration = vscode.workspace.getConfiguration('webcodeGateway');
        await configuration.update('port', gatewayPort, vscode.ConfigurationTarget.Global);
        await configuration.update(
            'servers',
            await loadGatewayServers(process.env.WEBCODE_QA_GATEWAY_CONFIG_PATH),
            vscode.ConfigurationTarget.Global
        );

        const extension = vscode.extensions.getExtension<EvaluationExtensionApi>(EXTENSION_ID);
        assert.ok(extension, `Extension ${EXTENSION_ID} should be loaded.`);
        const extensionApi = await extension.activate();
        assert.ok(extensionApi.evaluation, 'The QA Extension Host requires evaluation mode.');

        const control = await startInteractiveQaControl({
            extensionApi: {
                ...extensionApi,
                evaluation: extensionApi.evaluation,
            },
            runDirectory,
            token,
        });
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(path.join(runDirectory, 'control.json')),
            Buffer.from(`${JSON.stringify({
                schemaVersion: 1,
                status: 'ready',
                port: control.port,
                token,
                pid: process.pid,
            }, null, 2)}\n`, 'utf8')
        );

        try {
            await control.stopped;
        } finally {
            await extensionApi.evaluation.stop();
            await control.close();
        }
    });
});

function requireEnvironmentPath(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }
    return value;
}

async function loadGatewayServers(configPath: string | undefined): Promise<Record<string, unknown>> {
    if (!configPath?.trim()) {
        return {};
    }
    const parsed: unknown = JSON.parse(await fs.readFile(path.resolve(configPath), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('servers' in parsed)) {
        throw new Error(`Invalid QA Gateway configuration: ${configPath}`);
    }
    const servers = parsed.servers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
        throw new Error(`QA Gateway configuration must contain a servers object: ${configPath}`);
    }
    return servers as Record<string, unknown>;
}
