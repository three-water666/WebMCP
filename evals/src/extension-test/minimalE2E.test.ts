import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import * as vscode from 'vscode';

import { appendEvalTrace, readEvalTrace } from '../harness/trace';
import { loadScenario } from '../harness/scenario';
import { DeterministicFixtureSite } from './fixtureSite';

interface EvaluationExtensionApi {
    getGatewayState(): {
        currentPort: number | null;
        isStarting: boolean;
        isRunning: boolean;
    };
    evaluation?: {
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

const EXTENSION_ID = 'three-water666.gateway-vscode';

suite('Deterministic minimal E2E', () => {
    let browserContext: BrowserContext | undefined;
    let fixtureSite: DeterministicFixtureSite | undefined;
    let extensionApi: EvaluationExtensionApi | undefined;

    teardown(async () => {
        await browserContext?.close();
        await extensionApi?.evaluation?.stop();
        await fixtureSite?.close();
    });

    test('round-trips read and write tool calls through the real browser bridge and Gateway', async () => {
        const runDirectory = requireEnvironmentPath('WEBCODE_EVAL_RUN_DIR');
        const tracePath = requireEnvironmentPath('WEBCODE_EVAL_TRACE_PATH');
        const scenarioPath = requireEnvironmentPath('WEBCODE_EVAL_SCENARIO_PATH');
        const browserPath = requireEnvironmentPath('WEBCODE_EVAL_BROWSER_PATH');
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.ok(workspacePath, 'The isolated evaluation workspace must be open.');

        const runId = path.basename(runDirectory);
        const scenario = await loadScenario(scenarioPath);
        fixtureSite = new DeterministicFixtureSite(scenario, runId, tracePath);
        const fixtureUrl = await fixtureSite.start();

        await configureEvaluationSite(fixtureUrl);
        const extension = vscode.extensions.getExtension<EvaluationExtensionApi>(EXTENSION_ID);
        assert.ok(extension, `Extension ${EXTENSION_ID} should be installed in the Extension Host.`);
        extensionApi = await extension.activate();
        assert.ok(extensionApi.evaluation, 'The evaluation API should be enabled only in the E2E Extension Host.');

        const bridgeUrl = await extensionApi.evaluation.startAndCreateBridgeUrl('eval-fixture', fixtureUrl);
        appendEvalTrace(tracePath, {
            runId,
            source: 'browser',
            event: 'browser_launching',
            status: 'started',
            details: { browserPath, fixtureUrl },
        });

        const repoRoot = path.resolve(__dirname, '..', '..', '..');
        const bridgeExtensionPath = path.join(repoRoot, 'bridge-browser', 'dist');
        browserContext = await chromium.launchPersistentContext(path.join(runDirectory, 'browser-profile'), {
            executablePath: browserPath,
            headless: false,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                `--disable-extensions-except=${bridgeExtensionPath}`,
                `--load-extension=${bridgeExtensionPath}`,
                '--disable-background-networking',
                '--disable-component-update',
                '--no-default-browser-check',
                '--no-first-run',
            ],
            viewport: { width: 1200, height: 900 },
        });

        const page = await openBridgePage(browserContext, bridgeUrl, fixtureUrl);
        appendEvalTrace(tracePath, {
            runId,
            source: 'browser',
            event: 'fixture_page_connected',
            status: 'success',
            details: { url: page.url() },
        });

        await approveToolOnce(page, tracePath, runId, 'read_file', 'eval_read_1');
        await approveToolOnce(page, tracePath, runId, 'write_file', 'eval_write_2');

        await page.locator('body[data-eval-state="completed"]').waitFor({
            state: 'attached',
            timeout: scenario.timeoutMs,
        });
        await page.screenshot({ path: path.join(runDirectory, 'minimal-e2e.png'), fullPage: true });

        assert.strictEqual(
            await fs.readFile(path.join(workspacePath, scenario.expected.writtenPath), 'utf8'),
            scenario.expected.writtenContent,
            'The write_file call should modify only the isolated evaluation workspace.'
        );
        assert.strictEqual(
            await page.locator('code[data-mcp-state="success"]').count(),
            2,
            'Both scripted tool calls should reach a successful visual state.'
        );

        await waitFor(() => countFixtureEvents(fixtureSite?.events ?? [], 'tool_result_submitted') === 2);
        const trace = readEvalTrace(tracePath);
        assertTraceContainsToolSuccess(trace, 'read_file', 'eval_read_1');
        assertTraceContainsToolSuccess(trace, 'write_file', 'eval_write_2');
        assert.ok(
            trace.some(event => event.event === 'scenario_completed' && event.status === 'success'),
            'The fixture site should report scenario completion.'
        );

        appendEvalTrace(tracePath, {
            runId,
            source: 'browser',
            event: 'minimal_e2e_assertions_passed',
            status: 'success',
        });
    });
});

async function configureEvaluationSite(fixtureUrl: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('webcodeGateway');
    await config.update('port', 34567, vscode.ConfigurationTarget.Global);
    await config.update('servers', {}, vscode.ConfigurationTarget.Global);
    await config.update('aiSites', [{
        id: 'eval-fixture',
        name: 'webcode deterministic eval',
        address: fixtureUrl,
        showQuickLaunch: false,
        selectors: {
            messageBlocks: '.assistant-message',
            codeBlocks: 'pre code',
            inputArea: '#eval-input',
            sendButton: '#eval-send',
            stopButton: '#eval-stop',
            maxInlineChars: 20000,
        },
    }], vscode.ConfigurationTarget.Global);
}

async function openBridgePage(
    browserContext: BrowserContext,
    bridgeUrl: string,
    fixtureUrl: string
): Promise<Page> {
    const page = await browserContext.newPage();
    await page.goto(bridgeUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForURL(url => url.origin === new URL(fixtureUrl).origin, { timeout: 45_000 });
    await page.locator('body[data-eval-state="running"]').waitFor({ state: 'attached', timeout: 45_000 });
    return page;
}

async function approveToolOnce(
    page: Page,
    tracePath: string,
    runId: string,
    toolName: string,
    requestId: string
): Promise<void> {
    const approveButton = page.locator('.btn-confirm');
    await approveButton.waitFor({ state: 'visible', timeout: 45_000 });
    const modalToolName = (await page.locator('.card .field .value').first().textContent())?.trim();
    assert.strictEqual(modalToolName, toolName, `Expected the approval modal for ${toolName}.`);
    await approveButton.click();
    await approveButton.waitFor({ state: 'detached', timeout: 10_000 });
    appendEvalTrace(tracePath, {
        runId,
        source: 'browser',
        event: 'tool_approval_confirmed',
        status: 'success',
        requestId,
        toolName,
    });
}

function assertTraceContainsToolSuccess(
    trace: ReturnType<typeof readEvalTrace>,
    toolName: string,
    requestId: string
): void {
    assert.ok(
        trace.some(event => (
            event.source === 'gateway'
            && event.event === 'tool_call_finished'
            && event.toolName === toolName
            && event.requestId === requestId
            && event.status === 'success'
        )),
        `Trace should contain a successful ${toolName} Gateway event for ${requestId}.`
    );
    assert.ok(
        trace.some(event => (
            event.source === 'fixture-site'
            && event.event === 'tool_result_injected'
            && event.requestId === requestId
        )),
        `Trace should contain a browser result injection event for ${requestId}.`
    );
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out waiting for the deterministic fixture event.');
}

function countFixtureEvents(
    events: DeterministicFixtureSite['events'],
    eventName: string
): number {
    return events.filter(event => event.event === eventName).length;
}

function requireEnvironmentPath(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }
    return value;
}
