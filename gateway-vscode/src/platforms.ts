import {
    isSiteNetworkCaptureConfig,
    type SiteNetworkCaptureConfig
} from '@webcode/shared';

export interface AISiteConfig {
    id?: string;
    name?: string;
    address?: string;
    showQuickLaunch?: boolean;
    browser?: string;
    capture?: Partial<SiteNetworkCaptureConfig>;
    selectors?: Partial<SiteSelectors>;
}

export interface ResolvedAiSiteConfig {
    id: string;
    name: string;
    address: string;
    showQuickLaunch?: boolean;
    browser?: string;
    capture?: SiteNetworkCaptureConfig;
    selectors: SiteSelectors;
}

export type BuiltinPlatformId = 'chatgpt' | 'gemini' | 'aistudio' | 'deepseek' | 'glm' | 'claude' | 'qwen';

export interface SiteSelectors {
    messageBlocks: string;
    codeBlocks: string;
    inputArea: string;
    sendButton: string;
    stopButton: string;
    maxInlineChars?: number;
    virtualizedMessages?: boolean;
}

const BUILTIN_AI_SITES: ResolvedAiSiteConfig[] = [
    {
        id: 'chatgpt',
        name: 'ChatGPT',
        address: 'https://chatgpt.com',
        showQuickLaunch: true,
        capture: {
            adapter: 'chatgpt-delta-v1',
            channels: ['commentary'],
            enabled: true,
            method: 'POST',
            strategy: 'network-preferred',
            transport: 'fetch-sse',
            url: 'https://chatgpt.com/backend-api/f/conversation'
        },
        selectors: {
            messageBlocks: '.agent-turn',
            codeBlocks: 'pre code',
            inputArea: '#prompt-textarea',
            sendButton: 'button[data-testid="send-button"]',
            stopButton: 'button[data-testid="stop-button"]',
            maxInlineChars: 20000
        }
    },
    {
        id: 'gemini',
        name: 'Gemini',
        address: 'https://gemini.google.com',
        showQuickLaunch: true,
        selectors: {
            messageBlocks: '.markdown',
            codeBlocks: 'pre code',
            inputArea: 'div[contenteditable="true"]',
            sendButton: 'button[aria-label="发送"], button[aria-label="Send"], button[aria-label*="Send"]',
            stopButton: 'button[aria-label*="Stop"], button[aria-label*="停止"]',
        }
    },
    {
        id: 'aistudio',
        name: 'aistudio',
        address: 'https://aistudio.google.com/',
        showQuickLaunch: true,
        selectors: {
            messageBlocks: "div[data-turn-role='Model']",
            codeBlocks: 'pre code',
            inputArea: 'textarea',
            sendButton: 'ms-run-button button',
            stopButton: 'ms-run-button button:has(.spin)',
        }
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        address: 'https://chat.deepseek.com',
        showQuickLaunch: true,
        selectors: {
            messageBlocks: '.ds-message',
            codeBlocks: '.ds-markdown.ds-assistant-message-main-content pre',
            inputArea: 'textarea.ds-scroll-area',
            sendButton: "div[role='button']:has(path[d^='M8.3125'])",
            stopButton: "div[role='button']:has(path[d^='M2 4.88'])",
            virtualizedMessages: true,
        }
    },
    {
        id: 'glm',
        name: 'GLM',
        address: 'https://chatglm.cn/',
        showQuickLaunch: true,
        selectors: {
            messageBlocks: '.code-box.flex1 > .answer-content-wrap',
            codeBlocks: 'pre code',
            inputArea: 'textarea.scroll-display-none',
            sendButton: '.enter.is-main-chat.m-three-row',
            stopButton: '.enter.is-main-chat.searching',
            maxInlineChars: 20000
        }
    },
    {
        id: 'claude',
        name: 'Claude',
        address: 'https://claude.ai/',
        showQuickLaunch: true,
        selectors: {
            messageBlocks: '.font-claude-response',
            codeBlocks: 'pre code',
            inputArea: 'div[contenteditable="true"]',
            sendButton: 'button[aria-label="Send message"]',
            stopButton: 'button[aria-label="Stop response"]',
        }
    },
    {
        id: 'qwen',
        name: 'Qwen',
        address: 'https://chat.qwen.ai/',
        showQuickLaunch: true,
        selectors: {
            messageBlocks: '.qwen-chat-message-dual-message .smulti-o-response-message-wrapper > .response-message-box:first-child .chat-response-message-right, .qwen-chat-message-assistant:not(.qwen-chat-message-dual-message) .chat-response-message-right',
            codeBlocks: '.qwen-markdown-code-body',
            inputArea: 'textarea.message-input-textarea',
            sendButton: '.chat-prompt-send-button .send-button',
            stopButton: '.chat-prompt-send-button .stop-button',
        }
    }
];

export function getBuiltinAiSites(): ResolvedAiSiteConfig[] {
    return BUILTIN_AI_SITES.map(cloneResolvedAiSite);
}

export function getConfiguredAiSites(configuredSites: AISiteConfig[] | undefined): ResolvedAiSiteConfig[] {
    const builtinSites = getBuiltinAiSites();

    if (!configuredSites || configuredSites.length === 0) {
        return builtinSites;
    }

    const configuredById = new Map<string, AISiteConfig>();
    const configuredByName = new Map<string, AISiteConfig>();

    for (const site of configuredSites) {
        const id = normalizeSiteId(site.id);
        if (id) {
            configuredById.set(id, site);
            continue;
        }

        const name = normalizeSiteName(site.name);
        if (name) {
            configuredByName.set(name, site);
        }
    }

    const usedConfiguredSites = new Set<AISiteConfig>();
    const mergedBuiltinSites = builtinSites.map(site => {
        const override = configuredById.get(site.id) ?? configuredByName.get(normalizeSiteName(site.name));
        if (!override) {
            return site;
        }

        usedConfiguredSites.add(override);
        return mergeAiSiteConfig(site, override);
    });

    const customSites = configuredSites
        .filter(site => !usedConfiguredSites.has(site))
        .map(resolveCustomAiSite)
        .filter((site): site is ResolvedAiSiteConfig => Boolean(site));

    return [...mergedBuiltinSites, ...customSites];
}

export function findAiSiteById(
    aiSites: readonly ResolvedAiSiteConfig[],
    siteId: string | null | undefined
): ResolvedAiSiteConfig | null {
    const normalizedSiteId = normalizeSiteId(siteId);
    if (!normalizedSiteId) {
        return null;
    }

    return aiSites.find(site => site.id === normalizedSiteId) ?? null;
}

export function getDefaultBridgeTarget(): string {
    return BUILTIN_AI_SITES[0].address;
}

export function isTargetAllowedForSite(target: string, site: Pick<ResolvedAiSiteConfig, 'address'>): boolean {
    const parsedTarget = parseHttpUrl(target);
    const parsedSiteAddress = parseHttpUrl(site.address);
    if (!parsedTarget || !parsedSiteAddress) {
        return false;
    }

    if (parsedTarget.origin !== parsedSiteAddress.origin) {
        return false;
    }

    const sitePath = normalizeUrlPath(parsedSiteAddress.pathname);
    if (sitePath === '/') {
        return true;
    }

    const targetPath = normalizeUrlPath(parsedTarget.pathname);
    return targetPath === sitePath || targetPath.startsWith(`${sitePath}/`);
}

export function normalizeSiteId(siteId: string | null | undefined): string {
    return String(siteId ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function mergeAiSiteConfig(base: ResolvedAiSiteConfig, override: AISiteConfig): ResolvedAiSiteConfig {
    return {
        ...base,
        name: readConfiguredString(override.name) ?? base.name,
        address: readConfiguredString(override.address) ?? base.address,
        showQuickLaunch: override.showQuickLaunch ?? base.showQuickLaunch,
        browser: override.browser ?? base.browser,
        capture: mergeSiteNetworkCaptureConfig(base.capture, override.capture),
        selectors: {
            ...base.selectors,
            ...(override.selectors ?? {})
        }
    };
}

function resolveCustomAiSite(site: AISiteConfig): ResolvedAiSiteConfig | null {
    const id = normalizeSiteId(site.id ?? site.name);
    const name = readConfiguredString(site.name) ?? readConfiguredString(site.id) ?? id;
    const address = readConfiguredString(site.address);
    const capture = resolveSiteNetworkCaptureConfig(site.capture);

    if (!id || !name || !address || !isCompleteSelectors(site.selectors) || (site.capture && !capture)) {
        return null;
    }

    return {
        id,
        name,
        address,
        showQuickLaunch: site.showQuickLaunch,
        browser: site.browser,
        capture,
        selectors: { ...site.selectors }
    };
}

function isCompleteSelectors(selectors: Partial<SiteSelectors> | undefined): selectors is SiteSelectors {
    return Boolean(
        selectors &&
        typeof selectors.messageBlocks === 'string' &&
        typeof selectors.codeBlocks === 'string' &&
        typeof selectors.inputArea === 'string' &&
        typeof selectors.sendButton === 'string' &&
        typeof selectors.stopButton === 'string' &&
        (
            selectors.maxInlineChars === undefined ||
            typeof selectors.maxInlineChars === 'number'
        ) &&
        (
            selectors.virtualizedMessages === undefined ||
            typeof selectors.virtualizedMessages === 'boolean'
        )
    );
}

function cloneResolvedAiSite(site: ResolvedAiSiteConfig): ResolvedAiSiteConfig {
    return {
        ...site,
        capture: cloneSiteNetworkCaptureConfig(site.capture),
        selectors: { ...site.selectors }
    };
}

function mergeSiteNetworkCaptureConfig(
    base: SiteNetworkCaptureConfig | undefined,
    override: Partial<SiteNetworkCaptureConfig> | undefined
): SiteNetworkCaptureConfig | undefined {
    if (!override) {
        return cloneSiteNetworkCaptureConfig(base);
    }

    const merged = {
        ...base,
        ...override,
        channels: override.channels ?? base?.channels
    };
    return isSiteNetworkCaptureConfig(merged)
        ? cloneSiteNetworkCaptureConfig(merged)
        : cloneSiteNetworkCaptureConfig(base);
}

function resolveSiteNetworkCaptureConfig(
    capture: Partial<SiteNetworkCaptureConfig> | undefined
): SiteNetworkCaptureConfig | undefined {
    if (!capture) {
        return undefined;
    }

    const resolved: Record<keyof SiteNetworkCaptureConfig, unknown> = {
        adapter: capture.adapter,
        channels: capture.channels ?? ['commentary'],
        enabled: capture.enabled ?? true,
        method: capture.method ?? 'POST',
        strategy: capture.strategy ?? 'network-preferred',
        transport: capture.transport ?? 'fetch-sse',
        url: capture.url
    };
    return isSiteNetworkCaptureConfig(resolved)
        ? cloneSiteNetworkCaptureConfig(resolved)
        : undefined;
}

function cloneSiteNetworkCaptureConfig(
    capture: SiteNetworkCaptureConfig | undefined
): SiteNetworkCaptureConfig | undefined {
    return capture
        ? { ...capture, channels: [...capture.channels] }
        : undefined;
}

function normalizeSiteName(name: string | undefined): string {
    return String(name ?? '').trim().toLowerCase();
}

function readConfiguredString(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed;
}

function parseHttpUrl(value: string): URL | null {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function normalizeUrlPath(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, '');
    return normalized === '' ? '/' : normalized;
}
