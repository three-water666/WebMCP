import * as assert from 'node:assert';
import * as path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import * as vscode from 'vscode';

import { appendEvalTrace, readEvalTrace } from '../harness/trace';
import { loadScenario } from '../harness/scenario';
import { DeterministicFixtureSite } from './fixtureSite';

interface EvaluationExtensionApi {
    evaluation?: {
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

interface ApprovalExpectation {
    command: string;
    mandatory: boolean;
    requestId: string;
    riskReason?: string;
    toolName: string;
}

const EXTENSION_ID = 'three-water666.gateway-vscode';

suite('Command risk approval E2E', () => {
    let browserContext: BrowserContext | undefined;
    let fixtureSite: DeterministicFixtureSite | undefined;
    let extensionApi: EvaluationExtensionApi | undefined;

    teardown(async () => {
        await browserContext?.close();
        await extensionApi?.evaluation?.stop();
        await fixtureSite?.close();
    });

    test('enforces normal approval, mandatory confirmation, and blocking through the browser bridge', async () => {
        const runDirectory = requireEnvironmentPath('WEBCODE_EVAL_RUN_DIR');
        const tracePath = requireEnvironmentPath('WEBCODE_EVAL_TRACE_PATH');
        const scenarioPath = requireEnvironmentPath('WEBCODE_EVAL_SCENARIO_PATH');
        const browserPath = requireEnvironmentPath('WEBCODE_EVAL_BROWSER_PATH');
        const scenario = await loadScenario(scenarioPath);
        assert.strictEqual(scenario.kind, 'contract-e2e');
        assert.strictEqual(scenario.expected.workflow, 'command-risk-approval');
        const expected = scenario.expected;
        const runId = path.basename(runDirectory);

        fixtureSite = new DeterministicFixtureSite(scenario, runId, tracePath);
        const fixtureUrl = await fixtureSite.start();
        await configureEvaluationSite(fixtureUrl);

        const extension = vscode.extensions.getExtension<EvaluationExtensionApi>(EXTENSION_ID);
        assert.ok(extension, `Extension ${EXTENSION_ID} should be installed in the Extension Host.`);
        extensionApi = await extension.activate();
        assert.ok(extensionApi.evaluation, 'The evaluation API should be enabled in the E2E Extension Host.');

        const bridgeUrl = await extensionApi.evaluation.startAndCreateBridgeUrl('eval-fixture', fixtureUrl);
        browserContext = await launchBrowser(runDirectory, browserPath);
        const page = await openBridgePage(browserContext, bridgeUrl, fixtureUrl);

        await approveToolOnce(page, tracePath, runId, {
            command: expected.allowedCommand,
            mandatory: false,
            requestId: 'eval_command_allowed_1',
            toolName: 'execute_command',
        });
        await approveToolOnce(page, tracePath, runId, {
            command: expected.confirmationCommand,
            mandatory: true,
            requestId: 'eval_command_confirm_2',
            riskReason: 'Inline code execution with node requires explicit approval.',
            toolName: 'execute_command',
        });
        await approveToolOnce(page, tracePath, runId, {
            command: expected.terminalConfirmationCommand,
            mandatory: true,
            requestId: 'eval_terminal_confirm_3',
            riskReason: 'Inline code execution with node requires explicit approval.',
            toolName: 'run_in_terminal',
        });

        await page.locator('body[data-eval-state="completed"]').waitFor({
            state: 'attached',
            timeout: scenario.timeoutMs,
        });
        await page.screenshot({ path: path.join(runDirectory, 'command-risk-e2e.png'), fullPage: true });

        assert.strictEqual(
            await page.locator('code[data-mcp-state="success"]').count(),
            4,
            'All four tool calls should reach the completed visual state.'
        );
        assert.strictEqual(await page.locator('.card').count(), 0, 'Blocked commands must not show an approval modal.');

        await waitFor(() => countFixtureEvents(fixtureSite?.events ?? [], 'tool_result_submitted') === 4);
        const trace = readEvalTrace(tracePath);
        assertTraceContainsToolSuccess(trace, 'execute_command', 'eval_command_allowed_1');
        assertTraceContainsToolSuccess(trace, 'execute_command', 'eval_command_confirm_2');
        assertTraceContainsToolSuccess(trace, 'run_in_terminal', 'eval_terminal_confirm_3');
        assert.ok(
            !trace.some(event => (
                event.source === 'gateway'
                && event.event === 'tool_call_started'
                && event.requestId === 'eval_command_blocked_4'
            )),
            'The blocked command must never reach Gateway execution.'
        );
        assert.ok(
            trace.some(event => (
                event.source === 'fixture-site'
                && event.event === 'blocked_command_observed'
                && event.status === 'success'
            )),
            'The fixture should receive the encoded PowerShell policy error.'
        );
    });
});

async function configureEvaluationSite(fixtureUrl: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('webcodeGateway');
    await config.update('port', 34567, vscode.ConfigurationTarget.Global);
    await config.update('servers', {}, vscode.ConfigurationTarget.Global);
    await config.update('aiSites', [{
        id: 'eval-fixture',
        name: 'webcode command risk eval',
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

async function launchBrowser(runDirectory: string, browserPath: string): Promise<BrowserContext> {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const bridgeExtensionPath = path.join(repoRoot, 'bridge-browser', 'dist');
    return chromium.launchPersistentContext(path.join(runDirectory, 'browser-profile'), {
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
    expectation: ApprovalExpectation
): Promise<void> {
    const card = page.locator('.card');
    const approveButton = card.locator('.btn-confirm');
    await approveButton.waitFor({ state: 'visible', timeout: 45_000 });
    const modalToolName = (await card.locator('.field .value').first().textContent())?.trim();
    assert.strictEqual(
        modalToolName,
        expectation.toolName,
        `Expected the approval modal for ${expectation.toolName}.`
    );
    assert.strictEqual(
        readCommandArgument(await card.locator('.field .value').nth(2).textContent()),
        expectation.command,
        'The approval modal should show the exact command arguments.'
    );

    const alwaysButtonVisible = await card.locator('.btn-always').isVisible();
    const riskReasons = card.locator('.risk-reasons');
    if (expectation.mandatory) {
        assert.strictEqual(alwaysButtonVisible, false, 'Mandatory confirmation must hide Always Allow.');
        assert.strictEqual(await riskReasons.count(), 1, 'Mandatory confirmation must show risk reasons.');
        assert.ok((await riskReasons.textContent())?.includes(expectation.riskReason ?? ''));
    } else {
        assert.strictEqual(alwaysButtonVisible, true, 'Normal tool approval should offer Always Allow.');
        assert.strictEqual(await riskReasons.count(), 0, 'Allowed commands should not show risk reasons.');
    }

    const cardHandle = await card.elementHandle();
    assert.ok(cardHandle, 'The approval card should be attached before confirmation.');
    await approveButton.click();
    await cardHandle.waitForElementState('hidden', { timeout: 10_000 });
    appendEvalTrace(tracePath, {
        runId,
        source: 'browser',
        event: 'tool_approval_confirmed',
        status: 'success',
        requestId: expectation.requestId,
        toolName: expectation.toolName,
        details: { mandatory: expectation.mandatory },
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
        `Trace should contain a successful ${toolName} event for ${requestId}.`
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
    throw new Error('Timed out waiting for deterministic command risk events.');
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

function readCommandArgument(text: string | null): string | undefined {
    try {
        const value = JSON.parse(text ?? '') as unknown;
        return typeof value === 'object'
            && value !== null
            && 'command' in value
            && typeof value.command === 'string'
            ? value.command
            : undefined;
    } catch {
        return undefined;
    }
}
