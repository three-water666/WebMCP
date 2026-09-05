import * as crypto from 'crypto';
import type express from 'express';
import { BRANDING, BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { findAiSiteById, isTargetAllowedForSite, type ResolvedAiSiteConfig } from '../platforms';
import type { PendingBridgeLaunch } from './bridgeSession';
import type { GatewayLogger } from './types';

const BUNDLED_BRIDGE_EXTENSION_ORIGIN = 'chrome-extension://joieheegaphjokbcbklegmphhgpdfcon';
const CHROME_WEB_STORE_BRIDGE_EXTENSION_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio';
const ALLOWED_BRIDGE_REDEMPTION_ORIGINS = new Set([
    BUNDLED_BRIDGE_EXTENSION_ORIGIN,
    CHROME_WEB_STORE_BRIDGE_EXTENSION_ORIGIN
]);

type BridgeRouteOptions = {
    activateSession: () => string;
    consumeBridgeCode: (code: string) => PendingBridgeLaunch | null;
    getBridgeLaunch: (code: string) => PendingBridgeLaunch | null;
    getAiSites: () => readonly ResolvedAiSiteConfig[];
    getExtensionVersion: () => string;
    getIdleTimeoutMs: () => number;
    getWorkspaceRoot: () => string | null;
    log: GatewayLogger;
    recordActivity: () => void;
};

function createWorkspaceId(workspaceRoot: string | null): string {
    if (!workspaceRoot) {
        return 'global';
    }

    return crypto.createHash('md5').update(workspaceRoot).digest('hex').substring(0, 16);
}

export function registerBridgeRoute(app: express.Express, options: BridgeRouteOptions): void {
    app.get('/bridge', (req, res) => {
        setBridgeSecurityHeaders(res);
        const bridgeCode = getSingleQueryValue(req.query.bridgeCode);
        const launch = bridgeCode ? options.getBridgeLaunch(bridgeCode) : null;
        const resolvedLaunch = launch ? resolvePendingBridgeLaunch(launch, options.getAiSites()) : null;
        if (!bridgeCode || !resolvedLaunch) {
            options.log('⛔ Rejected missing, expired, or invalid bridge code.');
            res.status(400).send(renderInvalidBridgePage());
            return;
        }

        const releaseUrl = `${BRANDING.repositoryUrl}/releases`;
        const storeUrl = 'https://chromewebstore.google.com/detail/webcode-bridge/kghhldphcmpiimophipabdhldfipgiio';
        const vscodeExtensionVersion = options.getExtensionVersion();
        const workspaceId = createWorkspaceId(options.getWorkspaceRoot());

        options.log(`🌉 Bridge page requested for ${resolvedLaunch.site.id} in workspace [${workspaceId}].`);

        res.send(renderBridgePage({
            vscodeExtensionVersion,
            releaseUrl,
            storeUrl
        }));
    });

    app.post('/v1/bridge/redeem', (req, res) => {
        setBridgeSecurityHeaders(res);
        const origin = req.get('origin');
        if (!isAllowedBridgeRedemptionOrigin(origin)) {
            options.log(`⛔ Rejected bridge redemption from origin: ${origin ?? '<missing>'}`);
            res.status(403).json({
                success: false,
                error: 'Bridge redemption is only available to the WebCode browser extension.'
            });
            return;
        }

        const redemptionRequest = getBridgeRedemptionFromBody(req.body);
        if (!redemptionRequest) {
            options.log('⛔ Rejected malformed bridge redemption request.');
            res.status(400).json({
                success: false,
                error: 'A bridge code, browser extension version, and bridge protocol version are required.'
            });
            return;
        }
        if (redemptionRequest.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
            options.log('⛔ Rejected bridge redemption using an incompatible bridge protocol.');
            res.status(409).json({
                success: false,
                error: 'VS Code and browser bridge protocol versions do not match.'
            });
            return;
        }
        if (redemptionRequest.browserExtensionVersion !== options.getExtensionVersion()) {
            options.log('⛔ Rejected bridge redemption from an incompatible browser extension.');
            res.status(409).json({
                success: false,
                error: 'VS Code and browser extension versions do not match.'
            });
            return;
        }

        const bridgeCode = redemptionRequest.bridgeCode;
        const launch = bridgeCode ? options.consumeBridgeCode(bridgeCode) : null;
        const resolvedLaunch = launch ? resolvePendingBridgeLaunch(launch, options.getAiSites()) : null;
        if (!resolvedLaunch) {
            options.log('⛔ Rejected expired, used, or invalid bridge code redemption.');
            res.status(410).json({
                success: false,
                error: 'Bridge code expired or already used. Launch the site again from VS Code.'
            });
            return;
        }

        const token = options.activateSession();
        const workspaceId = createWorkspaceId(options.getWorkspaceRoot());
        options.recordActivity();
        options.log(`🔐 Bridge code redeemed for ${resolvedLaunch.site.id} in workspace [${workspaceId}].`);

        res.json({
            success: true,
            token,
            siteId: resolvedLaunch.site.id,
            targetOrigin: new URL(resolvedLaunch.targetUrl).origin,
            targetUrl: resolvedLaunch.targetUrl,
            vscodeExtensionVersion: options.getExtensionVersion(),
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            workspaceId,
            idleTimeoutMs: options.getIdleTimeoutMs()
        });
    });

    app.get('/favicon.ico', (_req, res) => {
        res.status(204).end();
    });
}

type BridgePageOptions = {
    vscodeExtensionVersion: string;
    releaseUrl: string;
    storeUrl: string;
};

function renderBridgePage({
    vscodeExtensionVersion,
    releaseUrl,
    storeUrl
}: BridgePageOptions): string {
    return `
                <!DOCTYPE html>
                <html>
                ${renderBridgeHead()}
                <body>
                    ${renderMainCard()}

                    ${renderBridgeData(vscodeExtensionVersion)}

                    ${renderInstallGuide({ releaseUrl, storeUrl })}

                    ${renderBridgeScript()}
                </body>
                </html>
            `;
}

export function resolveAllowedBridgeTarget(
    rawTarget: string,
    site: Pick<ResolvedAiSiteConfig, 'address'>
): string | null {
    let parsedTarget: URL;
    try {
        parsedTarget = new URL(rawTarget);
    } catch {
        return null;
    }

    if (parsedTarget.protocol !== 'https:' && parsedTarget.protocol !== 'http:') {
        return null;
    }

    if (!isTargetAllowedForSite(parsedTarget.href, site)) {
        return null;
    }

    return parsedTarget.href;
}

export function resolveBridgeSite(
    rawSiteId: string | null,
    aiSites: readonly ResolvedAiSiteConfig[]
): ResolvedAiSiteConfig | null {
    if (rawSiteId) {
        return findAiSiteById(aiSites, rawSiteId);
    }

    return aiSites[0] ?? null;
}

function resolvePendingBridgeLaunch(
    launch: PendingBridgeLaunch,
    aiSites: readonly ResolvedAiSiteConfig[]
): { site: ResolvedAiSiteConfig; targetUrl: string } | null {
    const site = resolveBridgeSite(launch.siteId, aiSites);
    if (!site) {
        return null;
    }

    const targetUrl = resolveAllowedBridgeTarget(launch.targetUrl, site);
    return targetUrl ? { site, targetUrl } : null;
}

export function isAllowedBridgeRedemptionOrigin(origin: string | undefined): boolean {
    return Boolean(origin && ALLOWED_BRIDGE_REDEMPTION_ORIGINS.has(origin));
}

function getBridgeRedemptionFromBody(
    body: unknown
): { bridgeCode: string; browserExtensionVersion: string; bridgeProtocolVersion: number } | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return null;
    }

    const record = body as Record<string, unknown>;
    const bridgeCode = typeof record.bridgeCode === 'string' ? record.bridgeCode.trim() : '';
    const browserExtensionVersion = typeof record.browserExtensionVersion === 'string'
        ? record.browserExtensionVersion.trim()
        : '';
    const bridgeProtocolVersion = record.bridgeProtocolVersion;
    return bridgeCode &&
        browserExtensionVersion &&
        typeof bridgeProtocolVersion === 'number' &&
        Number.isInteger(bridgeProtocolVersion)
        ? { bridgeCode, browserExtensionVersion, bridgeProtocolVersion }
        : null;
}

function getSingleQueryValue(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
    }

    return null;
}

function setBridgeSecurityHeaders(res: express.Response): void {
    res.set({
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
    });
}

function renderBridgeData(vscodeExtensionVersion: string): string {
    const legacyVersionMismatch = `bridge-protocol-${BRIDGE_PROTOCOL_VERSION}:${vscodeExtensionVersion}`;
    return `<script id="mcp-data" type="application/json">${escapeHtmlText(JSON.stringify({
        // 旧 bridge loader 会先读取这些字段，再检查版本。这里提供非敏感占位值，
        // 让它显示版本不一致，而不是在协议切换期间误报“链接参数无效”。
        token: 'bridge-upgrade-required',
        siteId: 'bridge-upgrade-required',
        target: 'http://127.0.0.1/',
        vscodeExtensionVersion: legacyVersionMismatch,
        currentVscodeExtensionVersion: vscodeExtensionVersion,
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION
    }))}</script>`;
}

function renderBridgeHead(): string {
    return `<head>
                    <title>${BRANDING.bridgeName}</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1e1e1e; color: #fff; text-align: center; }
                        .loader { border: 3px solid #333; border-top: 3px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
                        .card { background: #252526; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); max-width: 400px; }
                        h2 { margin-top: 0; color: #3498db; }
                        p { color: #cccccc; }
                        .warn { color: #e67e22; font-size: 0.9em; margin-top: 10px; }
                        button { background: #3498db; border: none; padding: 10px 20px; color: white; border-radius: 4px; cursor: pointer; margin-top: 15px; }
                        button:hover { background: #2980b9; }
                        .download-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
                        .download-link { display:inline-block; color:white; padding:10px 16px; text-decoration:none; border-radius:4px; font-weight:bold; }
                        .download-link.store { background:#2ea043; }
                        .download-link.store:hover { background:#238636; }
                        .download-link.github { background:#e74c3c; }
                        .download-link.github:hover { background:#c0392b; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>`;
}

function renderMainCard(): string {
    return `<div class="card" id="main-card">
                        <div class="loader" id="loader"></div>
                        <h2 id="bridge-title">Connecting to ${BRANDING.productName}...</h2>
                        <p id="bridge-status">Synchronizing with VS Code...</p>
                    </div>`;
}

function renderInstallGuide({ releaseUrl, storeUrl }: Pick<BridgePageOptions, 'releaseUrl' | 'storeUrl'>): string {
    return `<div class="card" id="install-guide" style="display:none; border: 1px solid #e74c3c; box-shadow: 0 4px 15px rgba(231, 76, 60, 0.2);">
                        <h2 id="install-title" style="color:#e74c3c; margin-bottom:10px">⚠️ Extension Required</h2>
                        <p id="install-desc" style="margin-bottom:20px">To enable auto-connection, you need the companion browser extension:</p>
                        <div style="background:#333; padding:10px; border-radius:6px; margin-bottom:20px; font-weight:bold; color:#fff">
                            🧩 ${BRANDING.bridgeName}
                        </div>
                        <div class="download-actions">
                            <a id="install-store-button" class="download-link store" href="${escapeHtmlAttr(storeUrl)}" target="_blank" rel="noopener noreferrer">
                                Chrome Web Store
                            </a>
                            <a id="install-github-button" class="download-link github" href="${escapeHtmlAttr(releaseUrl)}" target="_blank" rel="noopener noreferrer">
                                GitHub Releases
                            </a>
                        </div>
                        <p id="install-warn" class="warn" style="margin-top:15px; font-size:12px">Already installed? Try reloading this page.</p>
                    </div>`;
}

function renderBridgeScript(): string {
    return `<script>
                        const productName = ${toSafeScriptJson(BRANDING.productName)};
                        const isZh = navigator.language.toLowerCase().startsWith('zh');
                        const bridgeI18n = isZh ? {
                            connectingTitle: '正在连接 ' + productName + '...',
                            connectingStatus: '正在与 VS Code 同步...',
                            installTitle: '需要浏览器扩展',
                            installDesc: '要启用自动连接，您需要先安装配套的浏览器扩展：',
                            storeButton: '去插件商店下载',
                            githubButton: '去 GitHub 下载',
                            installWarn: '如果已经安装，请尝试刷新当前页面。'
                        } : {
                            connectingTitle: 'Connecting to ' + productName + '...',
                            connectingStatus: 'Synchronizing with VS Code...',
                            installTitle: 'Browser Extension Required',
                            installDesc: 'To enable auto-connection, you need the companion browser extension:',
                            storeButton: 'Download from Store',
                            githubButton: 'Download from GitHub',
                            installWarn: 'Already installed? Try reloading this page.'
                        };
                        window.__bridgeI18n = bridgeI18n;
                        document.getElementById('bridge-title').textContent = bridgeI18n.connectingTitle;
                        document.getElementById('bridge-status').textContent = bridgeI18n.connectingStatus;
                        document.getElementById('install-title').textContent = bridgeI18n.installTitle;
                        document.getElementById('install-desc').textContent = bridgeI18n.installDesc;
                        document.getElementById('install-store-button').textContent = bridgeI18n.storeButton;
                        document.getElementById('install-github-button').textContent = bridgeI18n.githubButton;
                        document.getElementById('install-warn').textContent = bridgeI18n.installWarn;

                        const installDetectionTimeoutMs = 10000;
                        const installDetectionPollMs = 100;
                        const bridgeSignalEventName = 'webcode-bridge-extension-installed';
                        let installDetectionSettled = false;
                        let installDetectionTimer = null;
                        let installDetectionPollTimer = null;
                        let installDetectionObserver = null;

                        function hasBridgeExtensionSignal() {
                            const isInstalled = document.documentElement.getAttribute('data-extension-installed') === 'true';
                            const bridgeState = document.body.dataset.bridgeState;
                            const handledByExtension = bridgeState === 'conflict'
                                || bridgeState === 'switching'
                                || bridgeState === 'connected'
                                || bridgeState === 'error';

                            return isInstalled || handledByExtension;
                        }

                        function stopInstallDetection() {
                            if (installDetectionSettled) {
                                return;
                            }

                            installDetectionSettled = true;
                            if (installDetectionTimer !== null) {
                                window.clearTimeout(installDetectionTimer);
                            }
                            if (installDetectionPollTimer !== null) {
                                window.clearInterval(installDetectionPollTimer);
                            }
                            if (installDetectionObserver) {
                                installDetectionObserver.disconnect();
                            }
                            window.removeEventListener(bridgeSignalEventName, checkBridgeExtensionSignal);
                        }

                        function checkBridgeExtensionSignal() {
                            if (!installDetectionSettled && hasBridgeExtensionSignal()) {
                                stopInstallDetection();
                            }
                        }

                        function showInstallGuideIfNoExtensionSignal() {
                            if (hasBridgeExtensionSignal()) {
                                stopInstallDetection();
                                return;
                            }

                            stopInstallDetection();
                            document.getElementById('main-card').style.display = 'none';
                            document.getElementById('install-guide').style.display = 'block';
                        }

                        window.addEventListener(bridgeSignalEventName, checkBridgeExtensionSignal);
                        installDetectionObserver = new MutationObserver(checkBridgeExtensionSignal);
                        installDetectionObserver.observe(document.documentElement, {
                            attributes: true,
                            attributeFilter: ['data-extension-installed']
                        });
                        installDetectionObserver.observe(document.body, {
                            attributes: true,
                            attributeFilter: ['data-bridge-state']
                        });
                        installDetectionPollTimer = window.setInterval(checkBridgeExtensionSignal, installDetectionPollMs);
                        installDetectionTimer = window.setTimeout(showInstallGuideIfNoExtensionSignal, installDetectionTimeoutMs);
                        checkBridgeExtensionSignal();
                    </script>`;
}

function renderInvalidBridgePage(): string {
    return `<!DOCTYPE html>
                <html>
                ${renderBridgeHead()}
                <body>
                    <div class="card" id="main-card">
                        <h2 id="bridge-title">Invalid bridge target</h2>
                        <p id="bridge-status">This bridge link does not match a configured AI site.</p>
                    </div>
                </body>
                </html>`;
}

function escapeHtmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function toSafeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
