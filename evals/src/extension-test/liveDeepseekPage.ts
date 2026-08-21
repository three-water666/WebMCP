import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright-core';

import { appendEvalTrace } from '../harness/trace';
import type {
    LiveCompletionSummary,
    LivePageState,
    LiveSiteSelectors,
    LiveTraceContext
} from './liveDeepseekTypes';

const DEEPSEEK_ASSISTANT_SELECTOR = '.ds-markdown.ds-assistant-message-main-content';
const LOGIN_STATUS_DELAY_MS = 5_000;
const POLL_INTERVAL_MS = 500;
const RESPONSE_SETTLE_MS = 10_000;

export async function openDeepSeekPage(
    browserContext: BrowserContext,
    bridgeUrl: string,
    targetUrl: string,
    trace: LiveTraceContext
): Promise<Page> {
    const page = await browserContext.newPage();
    await page.goto(bridgeUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForURL(url => url.origin === new URL(targetUrl).origin, { timeout: 45_000 });
    appendBrowserTrace(trace, 'deepseek_bridge_connected', 'success', { url: page.url() });
    return page;
}

export async function waitForDeepSeekLogin(
    page: Page,
    selectors: LiveSiteSelectors,
    timeoutMs: number,
    trace: LiveTraceContext
): Promise<void> {
    const input = page.locator(selectors.inputArea).last();
    const alreadyReady = await input.isVisible().catch(() => false);
    if (!alreadyReady) {
        appendBrowserTrace(trace, 'deepseek_login_waiting', 'started', { timeoutMs, url: page.url() });
        console.log('\nDeepSeek login is required in the isolated Edge window.');
        console.log('Complete login or verification there; the evaluation will continue automatically.\n');
        await new Promise(resolve => setTimeout(resolve, LOGIN_STATUS_DELAY_MS));
    }

    await input.waitFor({ state: 'visible', timeout: timeoutMs });
    await input.waitFor({ state: 'attached', timeout: 10_000 });
    appendBrowserTrace(trace, 'deepseek_login_ready', 'success', { url: page.url() });
}

export async function selectDeepSeekModelMode(
    page: Page,
    modelMode: string | undefined,
    trace: LiveTraceContext
): Promise<void> {
    if (!modelMode) {
        return;
    }
    if (modelMode !== 'expert') {
        throw new Error(`Unsupported DeepSeek model mode: ${modelMode}`);
    }

    const selector = '[role="radio"][data-model-type="expert"]';
    const expertMode = page.locator(selector);
    await expertMode.waitFor({ state: 'visible', timeout: 15_000 });
    const wasSelected = await expertMode.getAttribute('aria-checked') === 'true';
    if (!wasSelected) {
        await expertMode.click();
        await waitForAttribute(page, selector, 'aria-checked', 'true');
    }
    const isSelected = await expertMode.getAttribute('aria-checked') === 'true';
    if (!isSelected) {
        throw new Error('DeepSeek expert mode did not become selected.');
    }
    appendBrowserTrace(
        trace,
        wasSelected ? 'deepseek_model_mode_ready' : 'deepseek_model_mode_selected',
        'success',
        { modelMode, selector }
    );
    console.log(`DeepSeek expert mode ${wasSelected ? 'already selected' : 'selected automatically'}.`);
}

export async function ensureDeepSeekDeepThinking(
    page: Page,
    enabled: boolean | undefined,
    trace: LiveTraceContext
): Promise<void> {
    if (enabled === undefined) {
        return;
    }
    const selector = '[aria-pressed]';
    const toggle = page.locator(selector).filter({ hasText: '深度思考' }).first();
    await toggle.waitFor({ state: 'visible', timeout: 15_000 });
    const wasEnabled = await toggle.getAttribute('aria-pressed') === 'true';
    if (wasEnabled !== enabled) {
        await toggle.click();
        await waitForDeepThinkingState(page, enabled);
    }
    const isEnabled = await toggle.getAttribute('aria-pressed') === 'true';
    if (isEnabled !== enabled) {
        throw new Error(`DeepSeek Deep Thinking did not become ${enabled ? 'enabled' : 'disabled'}.`);
    }
    appendBrowserTrace(trace, 'deepseek_deep_thinking_ready', 'success', {
        enabled,
        changed: wasEnabled !== enabled,
    });
    console.log(`DeepSeek Deep Thinking is ${enabled ? 'enabled' : 'disabled'}.`);
}

export async function waitForManualDeepSeekSetup(
    delayMs: number,
    trace: LiveTraceContext
): Promise<void> {
    if (delayMs === 0) {
        return;
    }
    appendBrowserTrace(trace, 'deepseek_manual_setup_waiting', 'started', { delayMs });
    console.log(`\nDeepSeek manual setup window: ${Math.ceil(delayMs / 1000)} seconds.`);
    console.log('Select the desired model and enable Deep Thinking before the timer ends.\n');
    await delay(delayMs);
    appendBrowserTrace(trace, 'deepseek_manual_setup_finished', 'success', { delayMs });
}

export async function submitLiveTask(
    page: Page,
    selectors: LiveSiteSelectors,
    task: string,
    trace: LiveTraceContext
): Promise<number> {
    const initialMessageCount = await page.locator(selectors.messageBlocks).count();
    const input = page.locator(selectors.inputArea).last();
    const promptedTask = `${task.trim()}\n\n/webcode`;
    await input.fill(promptedTask);
    appendBrowserTrace(trace, 'deepseek_task_inserted', 'success', {
        initialMessageCount,
        taskLength: task.length,
    });

    const addButton = page.getByRole('button', { name: /^(添加|Add)$/ }).last();
    await addButton.waitFor({ state: 'visible', timeout: 30_000 });
    await addButton.click();
    const initializationState = await waitForInitializationReplacement(
        page, selectors, promptedTask.length, initialMessageCount
    );
    appendBrowserTrace(trace, 'webcode_context_inserted', 'success', { initializationState });

    if (initializationState === 'ready') {
        await sendCurrentInput(page, input, selectors, trace);
    }
    await waitForConversationStart(page, selectors, initialMessageCount);
    appendBrowserTrace(trace, 'deepseek_task_sent', 'success');
    return initialMessageCount;
}

export async function waitForLiveCompletion(options: {
    approvedTools: ReadonlySet<string>;
    initialMessageCount: number;
    page: Page;
    selectors: LiveSiteSelectors;
    timeoutMs: number;
    trace: LiveTraceContext;
}): Promise<LiveCompletionSummary> {
    const { approvedTools, initialMessageCount, page, selectors, timeoutMs, trace } = options;
    const automatedApprovals: string[] = [];
    const manualApprovals: string[] = [];
    const warnings: string[] = [];
    const deadline = Date.now() + timeoutMs;
    let lastFingerprint = '';
    let stableSince = Date.now();
    let reportedManualSignature = '';

    while (Date.now() < deadline) {
        const approval = await inspectApproval(page);
        if (approval.visible) {
            stableSince = Date.now();
            const signature = `${approval.toolName}\n${approval.argumentsText}`;
            if (approval.toolName && approvedTools.has(approval.toolName)) {
                await approval.confirmButton.click();
                automatedApprovals.push(approval.toolName);
                appendBrowserTrace(trace, 'live_tool_auto_approved', 'success', { toolName: approval.toolName });
                reportedManualSignature = '';
            } else if (signature !== reportedManualSignature) {
                reportedManualSignature = signature;
                if (approval.toolName) {
                    manualApprovals.push(approval.toolName);
                }
                appendBrowserTrace(trace, 'live_tool_manual_approval_required', 'started', {
                    toolName: approval.toolName || 'unknown',
                });
                console.log(`Manual approval required in Edge: ${approval.toolName || 'unknown tool'}`);
            }
            await delay(POLL_INTERVAL_MS);
            continue;
        }
        reportedManualSignature = '';

        const state = await readLivePageState(page, selectors);
        if (state.messageFingerprint !== lastFingerprint) {
            lastFingerprint = state.messageFingerprint;
            stableSince = Date.now();
        }
        if (isCompletedState(state, initialMessageCount, stableSince)) {
            appendBrowserTrace(trace, 'deepseek_response_settled', 'success', {
                assistantMessages: state.assistantMessages,
                messageBlocks: state.messageBlocks,
            });
            return {
                assistantMessages: state.assistantMessages,
                automatedApprovals,
                finalUrl: page.url(),
                manualApprovals,
                messageBlocks: state.messageBlocks,
                warnings,
            };
        }
        await delay(POLL_INTERVAL_MS);
    }

    throw new Error(`DeepSeek live scenario timed out after ${timeoutMs}ms.`);
}

export async function captureDeepSeekArtifacts(options: {
    error?: unknown;
    page: Page;
    runDirectory: string;
    selectors: LiveSiteSelectors;
    status: 'passed' | 'failed';
    summary?: LiveCompletionSummary;
}): Promise<void> {
    const { error, page, runDirectory, selectors, status, summary } = options;
    const screenshotPath = path.join(runDirectory, `deepseek-${status}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    const messages = await page.locator(selectors.messageBlocks).allTextContents().catch(() => []);
    await fs.writeFile(path.join(runDirectory, 'deepseek-conversation.txt'), `${messages.join('\n\n---\n\n')}\n`, 'utf8');
    await fs.writeFile(path.join(runDirectory, 'deepseek-page.json'), `${JSON.stringify({
        status,
        capturedAt: new Date().toISOString(),
        url: page.url(),
        title: await page.title().catch(() => ''),
        messageBlocks: messages.length,
        summary,
        error: describeError(error),
    }, null, 2)}\n`, 'utf8');
}

function describeError(error: unknown): string | undefined {
    if (error === undefined) {
        return undefined;
    }
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown non-Error failure';
    }
}

async function waitForInitializationReplacement(
    page: Page,
    selectors: LiveSiteSelectors,
    originalLength: number,
    initialMessageCount: number
): Promise<'ready' | 'sent'> {
    const stateHandle = await page.waitForFunction(
        ({ inputSelector, messageSelector, minimumLength, previousCount }) => {
            const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>(inputSelector));
            const element = candidates.find(candidate => candidate.offsetParent !== null) ?? candidates.at(-1);
            const value = element?.value ?? '';
            const hasContextMarker = value.includes('mcp_action') || value.includes('<available_tools>')
                || value.includes('Available Tools (Definitions Only)');
            if (value.length > minimumLength + 500 && hasContextMarker) {
                return 'ready';
            }
            if (document.querySelectorAll(messageSelector).length > previousCount && value.length === 0) {
                return 'sent';
            }
            return false;
        },
        {
            inputSelector: selectors.inputArea,
            messageSelector: selectors.messageBlocks,
            minimumLength: originalLength,
            previousCount: initialMessageCount,
        },
        { timeout: 45_000 }
    );
    const state = await stateHandle.jsonValue();
    return state === 'sent' ? 'sent' : 'ready';
}

async function sendCurrentInput(
    page: Page,
    input: Locator,
    selectors: LiveSiteSelectors,
    trace: LiveTraceContext
): Promise<void> {
    const configuredButton = page.locator(selectors.sendButton).last();
    if (await configuredButton.isVisible().catch(() => false)) {
        await configuredButton.click();
        return;
    }

    appendBrowserTrace(trace, 'deepseek_send_selector_fallback', 'error', {
        selector: selectors.sendButton,
    });
    await input.press('Enter');
}

async function waitForConversationStart(
    page: Page,
    selectors: LiveSiteSelectors,
    initialMessageCount: number
): Promise<void> {
    await page.waitForFunction(
        ({ inputSelector, messageSelector, previousCount }) => {
            const input = Array.from(document.querySelectorAll<HTMLTextAreaElement>(inputSelector)).at(-1);
            return document.querySelectorAll(messageSelector).length > previousCount || input?.value === '';
        },
        {
            inputSelector: selectors.inputArea,
            messageSelector: selectors.messageBlocks,
            previousCount: initialMessageCount,
        },
        { timeout: 45_000 }
    );
}

async function inspectApproval(page: Page): Promise<{
    argumentsText: string;
    confirmButton: Locator;
    toolName: string;
    visible: boolean;
}> {
    const confirmButton = page.locator('.btn-confirm').last();
    const visible = await confirmButton.isVisible().catch(() => false);
    if (!visible) {
        return { argumentsText: '', confirmButton, toolName: '', visible: false };
    }
    const values = page.locator('#view-main .field .value');
    return {
        argumentsText: (await values.nth(2).textContent().catch(() => ''))?.trim() ?? '',
        confirmButton,
        toolName: (await values.first().textContent().catch(() => ''))?.trim() ?? '',
        visible: true,
    };
}

async function readLivePageState(page: Page, selectors: LiveSiteSelectors): Promise<LivePageState> {
    return page.evaluate(({ assistantSelector, inputSelector, messageSelector, stopSelector }) => {
        const inputCandidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>(inputSelector));
        const input = inputCandidates.find(element => element.offsetParent !== null) ?? inputCandidates.at(-1);
        const messages = Array.from(document.querySelectorAll<HTMLElement>(messageSelector));
        const assistantMessages = document.querySelectorAll(assistantSelector).length;
        const stop = document.querySelector<HTMLElement>(stopSelector);
        const stopVisible = Boolean(stop && stop.offsetParent !== null);
        const recentText = messages.slice(-3).map(message => message.innerText).join('\n---\n');
        return {
            assistantMessages,
            inputText: input?.value ?? '',
            messageBlocks: messages.length,
            messageFingerprint: recentText,
            stopVisible,
        };
    }, {
        assistantSelector: DEEPSEEK_ASSISTANT_SELECTOR,
        inputSelector: selectors.inputArea,
        messageSelector: selectors.messageBlocks,
        stopSelector: selectors.stopButton,
    });
}

function isCompletedState(state: LivePageState, initialMessageCount: number, stableSince: number): boolean {
    return state.assistantMessages > 0
        && state.messageBlocks > initialMessageCount
        && !state.stopVisible
        && state.inputText.trim() === ''
        && Date.now() - stableSince >= RESPONSE_SETTLE_MS;
}

function appendBrowserTrace(
    trace: LiveTraceContext,
    event: string,
    status: 'started' | 'success' | 'error',
    details?: Record<string, unknown>
): void {
    appendEvalTrace(trace.tracePath, {
        runId: trace.runId,
        source: 'browser',
        event,
        status,
        details,
    });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForAttribute(
    page: Page,
    selector: string,
    attribute: string,
    expected: string
): Promise<void> {
    await page.waitForFunction(
        ({ attributeName, expectedValue, targetSelector }) => (
            document.querySelector(targetSelector)?.getAttribute(attributeName) === expectedValue
        ),
        { attributeName: attribute, expectedValue: expected, targetSelector: selector },
        { timeout: 10_000 }
    );
}

async function waitForDeepThinkingState(page: Page, enabled: boolean): Promise<void> {
    await page.waitForFunction(
        expected => Array.from(document.querySelectorAll<HTMLElement>('[aria-pressed]')).some(element => (
            element.textContent?.trim() === '深度思考'
                && element.getAttribute('aria-pressed') === String(expected)
        )),
        enabled,
        { timeout: 10_000 }
    );
}
