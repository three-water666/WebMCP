import type { Page } from 'playwright-core';

export interface LiveSiteSelectors {
    messageBlocks: string;
    codeBlocks: string;
    inputArea: string;
    sendButton: string;
    stopButton: string;
}

export interface LiveSiteConfiguration {
    id: string;
    name: string;
    address: string;
    selectors: LiveSiteSelectors;
}

export interface LiveTraceContext {
    runId: string;
    tracePath: string;
}

export interface LiveCompletionSummary {
    assistantMessages: number;
    automatedApprovals: string[];
    finalUrl: string;
    manualApprovals: string[];
    messageBlocks: number;
    warnings: string[];
}

export interface LivePageState {
    assistantMessages: number;
    inputText: string;
    messageBlocks: number;
    messageFingerprint: string;
    stopVisible: boolean;
}

export interface LivePageArtifacts {
    page: Page;
    selectors: LiveSiteSelectors;
}
