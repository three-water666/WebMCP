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
import { isBrowserProcessRunning } from './processDetection';
import type { AISiteConfig } from './types';
import { escapeWindowsCmdArgument } from './windowsCmdArguments';

interface LaunchBridgeOptions {
    context: vscode.ExtensionContext;
    outputChannel?: vscode.OutputChannel;
    siteId: string;
    targetUrl: string;
    browserMode: string;
    currentPort: number;
    currentToken: string;
}

const ISOLATED_EDGE_PROFILE_HOME_URL = 'edge://newtab/';

export function launchBridge(options: LaunchBridgeOptions): void {
    const bridgeUrl = buildBridgeUrl(options.currentPort, options.currentToken, options.siteId, options.targetUrl);
    const finalBrowser = resolveBrowser(options.siteId, options.browserMode);

    openBrowser(bridgeUrl, finalBrowser, options.context, options.outputChannel);
}

export function launchIsolatedEdgeProfile(
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): void {
    void openIsolatedBrowser(ISOLATED_EDGE_PROFILE_HOME_URL, 'edge', context, outputChannel).catch(error => {
        void vscode.window.showErrorMessage(t('open_browser_failed', { message: getErrorMessage(error) }));
    });
}

function buildBridgeUrl(currentPort: number, currentToken: string, siteId: string, targetUrl: string): string {
    const params = new URLSearchParams({
        bridgeToken: currentToken,
        siteId,
        target: targetUrl
    });
    return `http://127.0.0.1:${currentPort}/bridge?${params.toString()}`;
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

function openBrowser(
    url: string,
    browserType: string,
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): void {
    void openBrowserAsync(url, browserType, context, outputChannel).catch(error => {
        void vscode.window.showErrorMessage(t('open_browser_failed', { message: getErrorMessage(error) }));
    });
}

async function openBrowserAsync(
    url: string,
    browserType: string,
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): Promise<void> {
    if (browserType === 'default') {
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
    }

    if (browserType === 'isolated-chrome' || browserType === 'isolated-edge') {
        await openIsolatedBrowser(url, browserType === 'isolated-edge' ? 'edge' : 'chrome', context, outputChannel);
        return;
    }

    if (browserType === 'user-profile-chrome' || browserType === 'user-profile-edge') {
        await openUserProfileKeepaliveBrowser(
            url,
            browserType === 'user-profile-edge' ? 'edge' : 'chrome',
            outputChannel
        );
        return;
    }

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
    url: string,
    browserFamily: BrowserFamily,
    context: vscode.ExtensionContext,
    outputChannel?: vscode.OutputChannel
): Promise<void> {
    const extensionPath = resolveBundledBrowserExtensionPath(context);
    if (!extensionPath) {
        void vscode.window.showErrorMessage(t('browser_extension_missing'));
        return;
    }

    const profileDir = await prepareIsolatedProfileDirForLaunch(browserFamily, context);
    if (!profileDir) {
        return;
    }

    const browserArgs = buildIsolatedBrowserArgs(url, profileDir, extensionPath);
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

    launchFirstAvailableBrowser(launchCommands, browserArgs, getBrowserDisplayName(browserFamily), {
        outputChannel
    });
}

async function openUserProfileKeepaliveBrowser(
    url: string,
    browserFamily: BrowserFamily,
    outputChannel?: vscode.OutputChannel
): Promise<void> {
    const browserName = getUserProfileBrowserDisplayName(browserFamily);
    const isAlreadyRunning = await isBrowserProcessRunning(browserFamily);
    if (isAlreadyRunning) {
        void vscode.window.showWarningMessage(t('user_profile_browser_running', { browser: browserName }));
    }

    const launchCommands = getUserProfileBrowserLaunchCommands(browserFamily, os.platform());
    launchFirstAvailableBrowser(launchCommands, buildKeepaliveBrowserArgs(url), browserName, {
        outputChannel
    });
}

function buildIsolatedBrowserArgs(url: string, profileDir: string, extensionPath: string): string[] {
    const normalizedExtensionPath = normalizeBrowserPath(extensionPath);
    const normalizedProfileDir = normalizeBrowserPath(profileDir);
    return [
        `--user-data-dir=${normalizedProfileDir}`,
        `--load-extension=${normalizedExtensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
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

function resolveBundledBrowserExtensionPath(context: vscode.ExtensionContext): string | null {
    const candidates = [
        path.join(context.extensionPath, 'browser-extension'),
        path.resolve(context.extensionPath, '..', 'bridge-browser', 'dist'),
        path.resolve(context.extensionPath, '..', '..', 'bridge-browser', 'dist')
    ];

    return candidates.find(isUnpackedBrowserExtension) ?? null;
}

function isUnpackedBrowserExtension(extensionPath: string): boolean {
    return fs.existsSync(path.join(extensionPath, 'manifest.json'));
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
        ], { fallback: { command: 'open', prefixArgs: ['-na', 'Microsoft Edge', '--args'] } });
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
    ], {
        fallback: {
            command: env.ComSpec ?? 'cmd.exe',
            prefixArgs: ['/d', '/v:off', '/s', '/c', 'start "" msedge.exe'],
            transformBrowserArgs: args => args.map(escapeWindowsCmdArgument),
            windowsVerbatimArguments: true,
            windowsHide: true
        },
        includeMissingAbsolute: true
    });
}

interface ToLaunchCommandOptions {
    fallback?: BrowserLaunchCommand;
    includeMissingAbsolute?: boolean;
}

function toLaunchCommands(
    candidates: Array<string | undefined | null>,
    options: ToLaunchCommandOptions = {}
): BrowserLaunchCommand[] {
    const commands: BrowserLaunchCommand[] = candidates
        .filter(Boolean)
        .map(candidate => expandHomePath(String(candidate)))
        .filter(candidate => options.includeMissingAbsolute === true || !path.isAbsolute(candidate) || fs.existsSync(candidate))
        .map(command => ({ command, prefixArgs: [] }));

    if (options.fallback) {
        commands.push(options.fallback);
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
