import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import * as vscode from 'vscode';

import { appendEvalTrace } from '../harness/trace';
import { loadScenario } from '../harness/scenario';
import {
    captureDeepSeekArtifacts,
    openDeepSeekPage,
    submitLiveTask,
    waitForDeepSeekLogin,
    waitForManualDeepSeekSetup,
    waitForLiveCompletion
} from './liveDeepseekPage';
import type { LiveSiteConfiguration } from './liveDeepseekTypes';

interface EvaluationExtensionApi {
    evaluation?: {
        getSiteConfiguration(siteId: string): LiveSiteConfiguration;
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

const EXTENSION_ID = 'three-water666.gateway-vscode';
const SITE_ID = 'deepseek';

suite('DeepSeek live-site evaluation', () => {
    let browserContext: BrowserContext | undefined;
    let extensionApi: EvaluationExtensionApi | undefined;
    let livePage: Page | undefined;

    teardown(async () => {
        await browserContext?.close();
        await extensionApi?.evaluation?.stop();
    });

    test('runs an agent scenario through the real DeepSeek website', async () => {
        const runDirectory = requireEnvironmentPath('WEBCODE_EVAL_RUN_DIR');
        const tracePath = requireEnvironmentPath('WEBCODE_EVAL_TRACE_PATH');
        const scenarioPath = requireEnvironmentPath('WEBCODE_EVAL_SCENARIO_PATH');
        const browserPath = requireEnvironmentPath('WEBCODE_EVAL_BROWSER_PATH');
        const profilePath = requireEnvironmentPath('WEBCODE_LIVE_PROFILE_PATH');
        const runId = path.basename(runDirectory);
        const trace = { runId, tracePath };
        const scenario = await loadScenario(scenarioPath);
        assert.strictEqual(scenario.kind, 'agent-eval', 'DeepSeek live evaluation requires an agent scenario.');

        try {
            await configureGateway(scenario.mcpServers);
            const extension = vscode.extensions.getExtension<EvaluationExtensionApi>(EXTENSION_ID);
            assert.ok(extension, `Extension ${EXTENSION_ID} should be loaded.`);
            extensionApi = await extension.activate();
            assert.ok(extensionApi.evaluation, 'Evaluation API must be enabled in the live Extension Host.');
            const site = extensionApi.evaluation.getSiteConfiguration(SITE_ID);
            const bridgeUrl = await extensionApi.evaluation.startAndCreateBridgeUrl(SITE_ID, site.address);

            await fs.mkdir(profilePath, { recursive: true });
            browserContext = await launchLiveBrowser(browserPath, profilePath);
            livePage = await openDeepSeekPage(browserContext, bridgeUrl, site.address, trace);
            await waitForDeepSeekLogin(livePage, site.selectors, readPositiveInteger('WEBCODE_LIVE_LOGIN_TIMEOUT_MS'), trace);
            await waitForManualDeepSeekSetup(
                readNonNegativeInteger('WEBCODE_LIVE_SETUP_DELAY_MS'),
                trace
            );

            const task = await fs.readFile(scenario.taskPath, 'utf8');
            const initialMessageCount = await submitLiveTask(livePage, site.selectors, task, trace);
            const summary = await waitForLiveCompletion({
                approvedTools: readApprovedTools(),
                initialMessageCount,
                page: livePage,
                selectors: site.selectors,
                timeoutMs: readPositiveInteger('WEBCODE_LIVE_RUN_TIMEOUT_MS'),
                trace,
            });
            await captureDeepSeekArtifacts({
                page: livePage,
                selectors: site.selectors,
                runDirectory,
                status: 'passed',
                summary,
            });
            appendEvalTrace(tracePath, {
                runId,
                source: 'browser',
                event: 'deepseek_live_execution_completed',
                status: 'success',
                details: { ...summary },
            });
        } catch (error) {
            if (livePage) {
                const site = extensionApi?.evaluation?.getSiteConfiguration(SITE_ID);
                if (site) {
                    await captureDeepSeekArtifacts({
                        page: livePage,
                        selectors: site.selectors,
                        runDirectory,
                        status: 'failed',
                        error,
                    });
                }
            }
            appendEvalTrace(tracePath, {
                runId,
                source: 'browser',
                event: 'deepseek_live_execution_failed',
                status: 'error',
                details: { error: error instanceof Error ? error.message : String(error) },
            });
            throw error;
        }
    });
});

async function configureGateway(mcpServers: Array<{
    args: string[];
    command: string;
    id: string;
    resolvedArgs: string[];
    type: 'stdio';
}>): Promise<void> {
    const config = vscode.workspace.getConfiguration('webcodeGateway');
    await config.update('port', 34567, vscode.ConfigurationTarget.Global);
    await config.update('aiSites', [], vscode.ConfigurationTarget.Global);
    await config.update('servers', Object.fromEntries(mcpServers.map(server => [server.id, {
        type: server.type,
        command: server.command,
        args: server.resolvedArgs,
    }])), vscode.ConfigurationTarget.Global);
}

async function launchLiveBrowser(browserPath: string, profilePath: string): Promise<BrowserContext> {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const bridgeExtensionPath = path.join(repoRoot, 'bridge-browser', 'dist');
    return chromium.launchPersistentContext(profilePath, {
        executablePath: browserPath,
        headless: false,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
            `--disable-extensions-except=${bridgeExtensionPath}`,
            `--load-extension=${bridgeExtensionPath}`,
            '--disable-component-update',
            '--no-default-browser-check',
            '--no-first-run',
        ],
        viewport: { width: 1440, height: 1000 },
    });
}

function readApprovedTools(): Set<string> {
    return new Set(
        (process.env.WEBCODE_LIVE_APPROVED_TOOLS ?? '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    );
}

function readPositiveInteger(name: string): number {
    const value = Number(requireEnvironmentPath(name));
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return value;
}

function readNonNegativeInteger(name: string): number {
    const value = Number(requireEnvironmentPath(name));
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative integer.`);
    }
    return value;
}

function requireEnvironmentPath(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }
    return value;
}
