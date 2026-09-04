import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { t } from '../i18n';
import { getConfiguredAiSites } from '../platforms';
import { launchFirstAvailableBrowser, type BrowserLaunchCommand } from './browserProcessLauncher';
import { getErrorMessage } from './errorUtils';
import { prepareIsolatedProfileDirForLaunch } from './isolatedProfileLaunch';
import { expandHomePath, type BrowserFamily } from './isolatedBrowserProfiles';
import {
    getBrowserBridgeMarkerArgument,
    getBrowserProfileMarkerArgument,
    isBrowserProcessRunning
} from './processDetection';
import type { AISiteConfig } from './types';
import { buildBridgeUrl } from './bridgeUrl';
import type { BrowserExtensionManager } from './browserExtensionManager';

interface LaunchBridgeOptions {
    context: vscode.ExtensionContext;
    siteId: string;
    browserMode: string;
    currentPort: number;
    issueBridgeCode: () => string;
    browserExtensionManager: BrowserExtensionManager;
}

const ISOLATED_EDGE_PROFILE_HOME_URL = 'edge://newtab/';

export async function launchBridge(options: LaunchBridgeOptions): Promise<void> {
    const finalBrowser = resolveBrowser(options.siteId, options.browserMode);
    await openBrowser(
        () => buildBridgeUrl(options.currentPort, options.issueBridgeCode()),
        finalBrowser,
        options.context,
        options.browserExtensionManager
    );
}

export async function launchIsolatedEdgeProfile(
    context: vscode.ExtensionContext,
    browserExtensionManager: BrowserExtensionManager
): Promise<void> {
    try {
        await openIsolatedBrowser(
            () => ISOLATED_EDGE_PROFILE_HOME_URL,
            'edge',
            context,
            browserExtensionManager
        );
    } catch (error: unknown) {
        void vscode.window.showErrorMessage(t('open_browser_failed', { message: getErrorMessage(error) }));
    }
}

function resolveBrowser(siteId: string, browserMode: string): string {
    const config = vscode.workspace.getConfiguration('webcodeGateway');

    if (browserMode !== 'auto') {
        return browserMode;
    }

    const aiSites = getConfiguredAiSites(config.get<AISiteConfig[]>('aiSites'));
    const matchedSite = aiSites.find(site => site.id === siteId);

    if (matchedSite?.browser && matchedSite.browser !== 'default') {
        return matchedSite.browser;
    }

    // 如果没有特定配置，使用全局默认设置
    return config.get<string>('browser') ?? 'isolated-edge';
}

async function openBrowser(
    getUrl: () => string,
    browserType: string,
    context: vscode.ExtensionContext,
    browserExtensionManager: BrowserExtensionManager
): Promise<void> {
    try {
        await openBrowserAsync(getUrl, browserType, context, browserExtensionManager);
    } catch (error: unknown) {
        void vscode.window.showErrorMessage(t('open_browser_failed', { message: getErrorMessage(error) }));
    }
}

async function openBrowserAsync(
    getUrl: () => string,
    browserType: string,
    context: vscode.ExtensionContext,
    browserExtensionManager: BrowserExtensionManager
): Promise<void> {
    if (browserType === 'default') {
        await vscode.env.openExternal(vscode.Uri.parse(getUrl()));
        return;
    }

    if (browserType === 'isolated-chrome' || browserType === 'isolated-edge') {
        await openIsolatedBrowser(
            getUrl,
            browserType === 'isolated-edge' ? 'edge' : 'chrome',
            context,
            browserExtensionManager
        );
        return;
    }

    if (browserType === 'user-profile-chrome' || browserType === 'user-profile-edge') {
        await openUserProfileKeepaliveBrowser(getUrl(), browserType === 'user-profile-edge' ? 'edge' : 'chrome');
        return;
    }

    const url = getUrl();
    const command = buildBrowserCommand(url, browserType, os.platform());

    if (command) {
        exec(command, (err) => {
            if (err) {
                void vscode.window.showErrorMessage(t('open_browser_failed', { message: err.message }));
            }
        });
        return;
    }

    void vscode.env.openExternal(vscode.Uri.parse(url));
}

async function openIsolatedBrowser(
    getUrl: () => string,
    browserFamily: BrowserFamily,
    context: vscode.ExtensionContext,
    browserExtensionManager: BrowserExtensionManager
): Promise<void> {
    const profileDir = await prepareIsolatedProfileDirForLaunch(browserFamily, context);
    if (!profileDir) {
        return;
    }

    if (browserFamily === 'chrome') {
        const invalidConfiguredPath = getInvalidConfiguredChromeForTestingPath();
        if (invalidConfiguredPath) {
            void vscode.window.showErrorMessage(t('isolated_chrome_configured_path_missing', {
                path: invalidConfiguredPath
            }));
            return;
        }
    }

    const launchCommands = getBrowserLaunchCommands(browserFamily, os.platform());
    if (launchCommands.length === 0 && browserFamily === 'chrome') {
        void vscode.window.showErrorMessage(t('isolated_chrome_requires_cft'));
        return;
    }

    await browserExtensionManager.launchWithReadyExtension({
        browserFamily,
        profileDir,
        launch: async extensionPath => {
            const browserArgs = buildIsolatedBrowserArgs(getUrl(), profileDir, extensionPath);
            return launchFirstAvailableBrowser(launchCommands, browserArgs, getBrowserDisplayName(browserFamily));
        }
    });
}

async function openUserProfileKeepaliveBrowser(url: string, browserFamily: BrowserFamily): Promise<void> {
    const browserName = getUserProfileBrowserDisplayName(browserFamily);
    const isAlreadyRunning = await isBrowserProcessRunning(browserFamily);
    if (isAlreadyRunning) {
        void vscode.window.showWarningMessage(t('user_profile_browser_running', { browser: browserName }));
    }

    const launchCommands = getUserProfileBrowserLaunchCommands(browserFamily, os.platform());
    await launchFirstAvailableBrowser(launchCommands, buildKeepaliveBrowserArgs(url), browserName);
}

function buildIsolatedBrowserArgs(url: string, profileDir: string, extensionPath: string): string[] {
    const normalizedExtensionPath = normalizeBrowserPath(extensionPath);
    const normalizedProfileDir = normalizeBrowserPath(profileDir);
    return [
        `--user-data-dir=${normalizedProfileDir}`,
        `--load-extension=${normalizedExtensionPath}`,
        getBrowserProfileMarkerArgument(profileDir),
        getBrowserBridgeMarkerArgument(extensionPath),
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-mode',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
        url
    ];
}

function buildKeepaliveBrowserArgs(url: string): string[] {
    return [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
        url
    ];
}

function normalizeBrowserPath(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, '/');
}

function getBrowserLaunchCommands(browserFamily: BrowserFamily, platform: NodeJS.Platform): BrowserLaunchCommand[] {
    if (platform === 'win32') {
        return getWindowsBrowserLaunchCommands(browserFamily);
    }

    if (platform === 'darwin') {
        return getMacBrowserLaunchCommands(browserFamily);
    }

    return getLinuxBrowserLaunchCommands(browserFamily);
}

function getWindowsBrowserLaunchCommands(browserFamily: BrowserFamily): BrowserLaunchCommand[] {
    const env = process.env;
    if (browserFamily === 'chrome') {
        return toLaunchCommands([
            getConfiguredChromeForTestingPath(),
            env.WEBCODE_CHROME_FOR_TESTING_PATH,
            env.CHROME_FOR_TESTING_PATH,
            env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Google', 'Chrome for Testing', 'Application', 'chrome.exe') : '',
            env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Google', 'Chrome for Testing', 'chrome-win64', 'chrome.exe') : '',
            env.ProgramFiles ? path.join(env.ProgramFiles, 'Google', 'Chrome for Testing', 'Application', 'chrome.exe') : '',
            env.ProgramFiles ? path.join(env.ProgramFiles, 'Google', 'Chrome for Testing', 'chrome-win64', 'chrome.exe') : '',
            env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome for Testing', 'Application', 'chrome.exe') : '',
            'chrome-for-testing.exe',
            'chromium.exe'
        ]);
    }

    return getWindowsEdgeLaunchCommands(env);
}

function getMacBrowserLaunchCommands(browserFamily: BrowserFamily): BrowserLaunchCommand[] {
    const home = os.homedir();
    if (browserFamily === 'edge') {
        return toLaunchCommands([
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            path.join(home, 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge')
        ], { command: 'open', prefixArgs: ['-na', 'Microsoft Edge', '--args'] });
    }

    return toLaunchCommands([
        getConfiguredChromeForTestingPath(),
        process.env.WEBCODE_CHROME_FOR_TESTING_PATH,
        process.env.CHROME_FOR_TESTING_PATH,
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        path.join(home, 'Applications', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        path.join(home, 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    ]);
}

function getLinuxBrowserLaunchCommands(browserFamily: BrowserFamily): BrowserLaunchCommand[] {
    if (browserFamily === 'edge') {
        return toLaunchCommands(['microsoft-edge', 'microsoft-edge-stable']);
    }

    return toLaunchCommands([
        getConfiguredChromeForTestingPath(),
        process.env.WEBCODE_CHROME_FOR_TESTING_PATH,
        process.env.CHROME_FOR_TESTING_PATH,
        'chrome-for-testing',
        'google-chrome-for-testing',
        'chromium',
        'chromium-browser'
    ]);
}

function getUserProfileBrowserLaunchCommands(
    browserFamily: BrowserFamily,
    platform: NodeJS.Platform
): BrowserLaunchCommand[] {
    if (platform === 'win32') {
        return browserFamily === 'edge'
            ? getWindowsEdgeLaunchCommands(process.env)
            : getWindowsChromeLaunchCommands(process.env);
    }

    if (platform === 'darwin') {
        return browserFamily === 'edge'
            ? toLaunchCommands([
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                path.join(os.homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge')
            ])
            : toLaunchCommands([
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
            ]);
    }

    return browserFamily === 'edge'
        ? toLaunchCommands(['microsoft-edge', 'microsoft-edge-stable'])
        : toLaunchCommands(['google-chrome', 'google-chrome-stable', 'chrome', 'chromium', 'chromium-browser']);
}

function getWindowsChromeLaunchCommands(env: NodeJS.ProcessEnv): BrowserLaunchCommand[] {
    return toLaunchCommands([
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
        env.ProgramFiles ? path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
        env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
        'chrome.exe'
    ]);
}

function getWindowsEdgeLaunchCommands(env: NodeJS.ProcessEnv): BrowserLaunchCommand[] {
    return toLaunchCommands([
        env.ProgramFiles ? path.join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
        env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
        env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
        'msedge.exe'
    ]);
}

function toLaunchCommands(candidates: Array<string | undefined | null>, fallback?: BrowserLaunchCommand): BrowserLaunchCommand[] {
    const commands: BrowserLaunchCommand[] = candidates
        .filter(Boolean)
        .map(candidate => expandHomePath(String(candidate)))
        .filter(candidate => !path.isAbsolute(candidate) || fs.existsSync(candidate))
        .map(command => ({ command, prefixArgs: [] }));

    if (fallback) {
        commands.push(fallback);
    }

    return commands;
}

function getBrowserDisplayName(browserFamily: BrowserFamily): string {
    return browserFamily === 'edge' ? 'Microsoft Edge' : 'Chrome for Testing / Chromium';
}

function getUserProfileBrowserDisplayName(browserFamily: BrowserFamily): string {
    return browserFamily === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
}

function getConfiguredChromeForTestingPath(): string | null {
    const configuredPath = vscode.workspace
        .getConfiguration('webcodeGateway')
        .get<string>('isolatedChrome.executablePath')
        ?.trim();

    if (!configuredPath) {
        return null;
    }

    return configuredPath;
}

function getInvalidConfiguredChromeForTestingPath(): string | null {
    const configuredPath = getConfiguredChromeForTestingPath();
    if (!configuredPath) {
        return null;
    }

    const expandedPath = expandHomePath(configuredPath);
    if (path.isAbsolute(expandedPath) && !fs.existsSync(expandedPath)) {
        return configuredPath;
    }

    return null;
}

function buildBrowserCommand(url: string, browserType: string, platform: NodeJS.Platform): string {
    if (platform === 'win32') {
        return buildWindowsBrowserCommand(url, browserType);
    }

    if (platform === 'darwin') {
        return buildMacBrowserCommand(url, browserType);
    }

    return buildLinuxBrowserCommand(url, browserType);
}

function buildWindowsBrowserCommand(url: string, browserType: string): string {
    if (browserType === 'chrome') {
        return `start chrome "${url}"`;
    }

    if (browserType === 'edge') {
        return `start msedge "${url}"`;
    }

    return '';
}

function buildMacBrowserCommand(url: string, browserType: string): string {
    if (browserType === 'chrome') {
        return `open -a "Google Chrome" "${url}"`;
    }

    if (browserType === 'edge') {
        return `open -a "Microsoft Edge" "${url}"`;
    }

    return '';
}

function buildLinuxBrowserCommand(url: string, browserType: string): string {
    if (browserType === 'chrome') {
        return `google-chrome "${url}"`;
    }

    return `xdg-open "${url}"`;
}

