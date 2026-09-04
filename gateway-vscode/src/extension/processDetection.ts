import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
    getBrowserFamily,
    getBrowserFamilyForExecutableName,
    isBrowserProcessRunningFallback,
    listAllProcesses,
    stopBrowserProcess,
    type BrowserProcessInfo
} from './browserProcessList';
import type { BrowserFamily } from './isolatedBrowserProfiles';

export { getBrowserFamilyForExecutableName };

export interface BrowserBridgeProcess {
    pid: number;
    browserFamily: BrowserFamily;
}

const PROFILE_MARKER_SWITCH = '--webcode-profile-id';
const BRIDGE_MARKER_SWITCH = '--webcode-bridge-id';
const PROCESS_POLL_INTERVAL_MS = 100;

export function getBrowserProfileMarkerArgument(
    profileDir: string,
    platform: NodeJS.Platform = os.platform()
): string {
    return createPathMarkerArgument(PROFILE_MARKER_SWITCH, profileDir, platform);
}

export function getBrowserBridgeMarkerArgument(
    extensionPath: string,
    platform: NodeJS.Platform = os.platform()
): string {
    return createPathMarkerArgument(BRIDGE_MARKER_SWITCH, extensionPath, platform);
}

export async function isBrowserProcessRunning(browserFamily: BrowserFamily): Promise<boolean> {
    const platform = os.platform();
    try {
        const processes = await listAllProcesses(platform);
        return processes.some(processInfo => getBrowserFamily(processInfo, platform) === browserFamily);
    } catch {
        return isBrowserProcessRunningFallback(browserFamily, platform);
    }
}

export async function isBrowserProfileInUse(browserFamily: BrowserFamily, profileDir: string): Promise<boolean> {
    try {
        if ((await getBrowserProfileProcessIds(browserFamily, profileDir)).length > 0) {
            return true;
        }
        return await hasLiveProfileSingletonLock(profileDir);
    } catch {
        return isBrowserProcessRunning(browserFamily);
    }
}

export async function getBrowserProfileProcessIds(
    browserFamily: BrowserFamily,
    profileDir: string
): Promise<number[]> {
    const platform = os.platform();
    const markerArgument = getBrowserProfileMarkerArgument(profileDir, platform);
    const processes = await listAllProcesses(platform);
    return uniqueProcessIds(processes.filter(processInfo => processMatchesProfile(
        processInfo,
        browserFamily,
        profileDir,
        markerArgument,
        platform
    )));
}

export async function getBrowserBridgeProcesses(extensionPath: string): Promise<BrowserBridgeProcess[]> {
    const platform = os.platform();
    const markerArgument = getBrowserBridgeMarkerArgument(extensionPath, platform);
    const matches = (await listAllProcesses(platform)).filter(processInfo => processMatchesBridge(
        processInfo,
        extensionPath,
        markerArgument,
        platform
    ));
    const seen = new Set<number>();
    return matches.flatMap(processInfo => {
        if (seen.has(processInfo.pid)) {
            return [];
        }
        seen.add(processInfo.pid);
        return [{
            pid: processInfo.pid,
            browserFamily: getBrowserFamily(processInfo, platform) ?? 'chrome'
        }];
    });
}

export async function waitForBrowserProfileBridgeProcess(
    browserFamily: BrowserFamily,
    profileDir: string,
    extensionPath: string,
    timeoutMs = 10_000
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await hasBrowserProfileBridgeProcess(browserFamily, profileDir, extensionPath)) {
            return true;
        }
        await delay(PROCESS_POLL_INTERVAL_MS);
    }
    return hasBrowserProfileBridgeProcess(browserFamily, profileDir, extensionPath);
}

export async function stopBrowserProfileProcesses(
    browserFamily: BrowserFamily,
    profileDir: string,
    timeoutMs = 5_000
): Promise<boolean> {
    const processIds = await getBrowserProfileProcessIds(browserFamily, profileDir);
    return stopAndWaitForProcesses(
        processIds,
        () => getBrowserProfileProcessIds(browserFamily, profileDir),
        timeoutMs
    );
}

export async function stopBrowserBridgeProcesses(
    extensionPath: string,
    timeoutMs = 5_000
): Promise<boolean> {
    const processIds = (await getBrowserBridgeProcesses(extensionPath)).map(processInfo => processInfo.pid);
    return stopAndWaitForProcesses(
        processIds,
        async () => (await getBrowserBridgeProcesses(extensionPath)).map(processInfo => processInfo.pid),
        timeoutMs
    );
}

export function browserArgumentsUseProfile(
    argv: readonly string[],
    profileDir: string,
    platform: NodeJS.Platform = os.platform()
): boolean {
    const markerArgument = getBrowserProfileMarkerArgument(profileDir, platform);
    if (argv.includes(markerArgument)) {
        return true;
    }
    const profileArg = readSwitchValueFromArguments(argv, '--user-data-dir');
    return Boolean(profileArg &&
        normalizeProcessPath(profileArg, platform) === normalizeProcessPath(profileDir, platform));
}

export function browserCommandLineUsesProfile(
    commandLine: string,
    profileDir: string,
    platform: NodeJS.Platform = os.platform()
): boolean {
    if (platform !== 'win32' && commandLineHasFlattenedSwitchValue(
        commandLine,
        '--user-data-dir',
        normalizeBrowserArgumentPath(profileDir, platform)
    )) {
        return true;
    }
    return browserArgumentsUseProfile(tokenizeCommandLine(commandLine), profileDir, platform);
}

export function commandLineHasExactArgument(commandLine: string, argument: string): boolean {
    const escapedArgument = escapeRegExp(argument);
    return new RegExp(`(?:^|\\s)${escapedArgument}(?=$|\\s)`).test(commandLine);
}

async function stopAndWaitForProcesses(
    processIds: number[],
    getRemainingProcessIds: () => Promise<number[]>,
    timeoutMs: number
): Promise<boolean> {
    if (processIds.length === 0) {
        return true;
    }

    await Promise.all(processIds.map(processId => stopBrowserProcess(processId, os.platform())));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await getRemainingProcessIds()).length === 0) {
            return true;
        }
        await delay(PROCESS_POLL_INTERVAL_MS);
    }
    return (await getRemainingProcessIds()).length === 0;
}

function createPathMarkerArgument(
    switchName: string,
    filePath: string,
    platform: NodeJS.Platform
): string {
    const normalizedPath = normalizeProcessPath(filePath, platform);
    const digest = crypto.createHash('sha256').update(normalizedPath).digest('hex');
    return `${switchName}=${digest}`;
}

async function hasBrowserProfileBridgeProcess(
    browserFamily: BrowserFamily,
    profileDir: string,
    extensionPath: string
): Promise<boolean> {
    const platform = os.platform();
    const profileMarker = getBrowserProfileMarkerArgument(profileDir, platform);
    const bridgeMarker = getBrowserBridgeMarkerArgument(extensionPath, platform);
    return (await listAllProcesses(platform)).some(processInfo =>
        processMatchesProfile(processInfo, browserFamily, profileDir, profileMarker, platform) &&
        processMatchesBridge(processInfo, extensionPath, bridgeMarker, platform)
    );
}

function processMatchesProfile(
    processInfo: BrowserProcessInfo,
    browserFamily: BrowserFamily,
    profileDir: string,
    markerArgument: string,
    platform: NodeJS.Platform
): boolean {
    return processHasExactArgument(processInfo, markerArgument, platform) ||
        getBrowserFamily(processInfo, platform) === browserFamily &&
        processUsesProfile(processInfo, profileDir, platform);
}

function processMatchesBridge(
    processInfo: BrowserProcessInfo,
    extensionPath: string,
    markerArgument: string,
    platform: NodeJS.Platform
): boolean {
    return processHasExactArgument(processInfo, markerArgument, platform) ||
        processLoadsExtension(processInfo, extensionPath, platform);
}

function processUsesProfile(
    processInfo: BrowserProcessInfo,
    profileDir: string,
    platform: NodeJS.Platform
): boolean {
    if (processInfo.argv) {
        return browserArgumentsUseProfile(processInfo.argv, profileDir, platform);
    }
    if (platform === 'win32') {
        return browserCommandLineUsesProfile(processInfo.commandLine, profileDir, platform);
    }
    return commandLineHasFlattenedSwitchValue(
        processInfo.commandLine,
        '--user-data-dir',
        normalizeBrowserArgumentPath(profileDir, platform)
    );
}

function processLoadsExtension(
    processInfo: BrowserProcessInfo,
    extensionPath: string,
    platform: NodeJS.Platform
): boolean {
    const expectedPath = normalizeProcessPath(extensionPath, platform);
    if (processInfo.argv) {
        const loadedPath = readSwitchValueFromArguments(processInfo.argv, '--load-extension');
        return Boolean(loadedPath && normalizeProcessPath(loadedPath, platform) === expectedPath);
    }
    if (platform === 'win32') {
        const loadedPath = readSwitchValueFromArguments(tokenizeCommandLine(processInfo.commandLine), '--load-extension');
        return Boolean(loadedPath && normalizeProcessPath(loadedPath, platform) === expectedPath);
    }
    return commandLineHasFlattenedSwitchValue(
        processInfo.commandLine,
        '--load-extension',
        normalizeBrowserArgumentPath(extensionPath, platform)
    );
}

function processHasExactArgument(
    processInfo: BrowserProcessInfo,
    argument: string,
    platform: NodeJS.Platform
): boolean {
    if (processInfo.argv) {
        return processInfo.argv.includes(argument);
    }
    if (platform === 'win32') {
        return tokenizeCommandLine(processInfo.commandLine).includes(argument);
    }
    return commandLineHasExactArgument(processInfo.commandLine, argument);
}

function commandLineHasFlattenedSwitchValue(
    commandLine: string,
    switchName: string,
    expectedValue: string
): boolean {
    const prefix = `${switchName}=`;
    const exactArgument = `${prefix}${expectedValue}`;
    if (commandLineHasExactArgument(commandLine, exactArgument) ||
        commandLineHasExactArgument(commandLine, `${prefix}"${expectedValue}"`) ||
        commandLineHasExactArgument(commandLine, `${prefix}'${expectedValue}'`)) {
        return true;
    }

    const escaped = escapeRegExp(exactArgument);
    return new RegExp(`(?:^|\\s)${escaped}(?=$|\\s+--)`).test(commandLine);
}

function readSwitchValueFromArguments(argv: readonly string[], switchName: string): string | null {
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === switchName) {
            return argv[index + 1] ?? null;
        }
        if (argument.startsWith(`${switchName}=`)) {
            return argument.slice(switchName.length + 1);
        }
    }
    return null;
}

async function hasLiveProfileSingletonLock(profileDir: string): Promise<boolean> {
    if (os.platform() === 'win32') {
        return false;
    }
    try {
        const lockTarget = await fs.readlink(path.join(profileDir, 'SingletonLock'));
        const match = /-(\d+)$/.exec(lockTarget);
        return Boolean(match && isProcessAlive(Number(match[1])));
    } catch {
        return false;
    }
}

function tokenizeCommandLine(commandLine: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    for (let index = 0; index < commandLine.length; index += 1) {
        const char = commandLine[index];
        if (quote) {
            const nextChar = commandLine[index + 1];
            if (char === '\\' && (nextChar === quote || nextChar === '\\')) {
                current += nextChar;
                index += 1;
            } else if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
        } else if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += char;
        }
    }
    if (current) {
        tokens.push(current);
    }
    return tokens;
}

function uniqueProcessIds(processes: BrowserProcessInfo[]): number[] {
    return [...new Set(processes.map(processInfo => processInfo.pid))];
}

function normalizeBrowserArgumentPath(filePath: string, platform: NodeJS.Platform): string {
    const platformPath = platform === 'win32' ? path.win32 : path.posix;
    return platformPath.resolve(filePath).replace(/\\/g, '/').replace(/\/+$/g, '');
}

function normalizeProcessPath(filePath: string, platform: NodeJS.Platform): string {
    const platformPath = platform === 'win32' ? path.win32 : path.posix;
    const normalized = platformPath.resolve(filePath).replace(/\\/g, '/').replace(/\/+$/g, '');
    return isCaseInsensitivePlatform(platform) ? normalized.toLowerCase() : normalized;
}

function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
    return platform === 'win32' || platform === 'darwin';
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        return hasErrorCode(error, 'EPERM');
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
