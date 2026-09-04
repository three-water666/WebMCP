import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import type { BrowserFamily } from './isolatedBrowserProfiles';

export async function isBrowserProcessRunning(browserFamily: BrowserFamily): Promise<boolean> {
    const platform = os.platform();

    if (platform === 'win32') {
        const imageName = browserFamily === 'edge' ? 'msedge.exe' : 'chrome.exe';
        const output = await execFileText('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH']);
        return output.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
    }

    const processNames = getBrowserProcessNames(browserFamily, platform);
    const results = await Promise.all(processNames.map(name => isProcessNameRunning(name)));
    return results.some(Boolean);
}

export async function isBrowserProfileInUse(browserFamily: BrowserFamily, profileDir: string): Promise<boolean> {
    const platform = os.platform();
    try {
        const commandLines = await listBrowserProcessCommandLines(browserFamily, platform);
        return commandLines.some(commandLine => browserCommandLineUsesProfile(commandLine, profileDir, platform));
    } catch {
        return isBrowserProcessRunning(browserFamily);
    }
}

export async function getBrowserProfileProcessIds(
    browserFamily: BrowserFamily,
    profileDir: string
): Promise<number[]> {
    const platform = os.platform();
    const processes = await listBrowserProcesses(browserFamily, platform);
    return processes
        .filter(processInfo => browserCommandLineUsesProfile(processInfo.commandLine, profileDir, platform))
        .map(processInfo => processInfo.pid);
}

export async function stopBrowserProfileProcesses(
    browserFamily: BrowserFamily,
    profileDir: string,
    timeoutMs = 5_000
): Promise<boolean> {
    const processIds = await getBrowserProfileProcessIds(browserFamily, profileDir);
    if (processIds.length === 0) {
        return true;
    }

    await Promise.all(processIds.map(processId => stopBrowserProcess(processId, os.platform())));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await getBrowserProfileProcessIds(browserFamily, profileDir)).length === 0) {
            return true;
        }
        await delay(100);
    }
    return (await getBrowserProfileProcessIds(browserFamily, profileDir)).length === 0;
}

export function browserCommandLineUsesProfile(
    commandLine: string,
    profileDir: string,
    platform: NodeJS.Platform = os.platform()
): boolean {
    const profileArg = readUserDataDirArgument(commandLine);
    if (!profileArg) {
        return false;
    }

    return normalizeProcessPath(profileArg, platform) === normalizeProcessPath(profileDir, platform);
}

function getBrowserProcessNames(browserFamily: BrowserFamily, platform: NodeJS.Platform): string[] {
    if (platform === 'darwin') {
        return browserFamily === 'edge' ? ['Microsoft Edge'] : ['Google Chrome', 'Google Chrome Helper'];
    }

    return browserFamily === 'edge'
        ? ['msedge', 'microsoft-edge', 'microsoft-edge-stable']
        : ['chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

async function isProcessNameRunning(processName: string): Promise<boolean> {
    try {
        await execFileText('pgrep', ['-x', processName]);
        return true;
    } catch {
        return isProcessNameRunningWithPs(processName);
    }
}

async function isProcessNameRunningWithPs(processName: string): Promise<boolean> {
    try {
        const output = await execFileText('ps', ['-A', '-o', 'comm=']);
        return output
            .split(/\r?\n/)
            .map(command => path.basename(command.trim()))
            .some(command => command === processName);
    } catch {
        return false;
    }
}

async function listBrowserProcessCommandLines(
    browserFamily: BrowserFamily,
    platform: NodeJS.Platform
): Promise<string[]> {
    return (await listBrowserProcesses(browserFamily, platform)).map(processInfo => processInfo.commandLine);
}

interface BrowserProcessInfo {
    pid: number;
    commandLine: string;
}

async function listBrowserProcesses(
    browserFamily: BrowserFamily,
    platform: NodeJS.Platform
): Promise<BrowserProcessInfo[]> {
    if (platform === 'win32') {
        return listWindowsBrowserProcesses(browserFamily);
    }

    return listPosixBrowserProcesses(browserFamily, platform);
}

async function listWindowsBrowserProcesses(browserFamily: BrowserFamily): Promise<BrowserProcessInfo[]> {
    const imageName = browserFamily === 'edge' ? 'msedge.exe' : 'chrome.exe';
    const command = [
        '$ErrorActionPreference = "Stop";',
        `$processes = @(Get-CimInstance Win32_Process -Filter "Name='${imageName}'" |`,
        'Select-Object ProcessId, CommandLine);',
        'ConvertTo-Json -InputObject $processes -Compress'
    ].join(' ');
    const output = await execFileText('powershell.exe', ['-NoProfile', '-Command', command]);
    const parsed: unknown = JSON.parse(output || '[]');
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed.flatMap(value => {
        if (!isRecord(value) ||
            typeof value.ProcessId !== 'number' ||
            typeof value.CommandLine !== 'string') {
            return [];
        }
        return [{ pid: value.ProcessId, commandLine: value.CommandLine }];
    });
}

async function listPosixBrowserProcesses(
    browserFamily: BrowserFamily,
    platform: NodeJS.Platform
): Promise<BrowserProcessInfo[]> {
    const output = await execFileText('ps', [platform === 'darwin' ? '-axo' : '-eo', 'pid=,args=']);
    const processNames = getBrowserProcessNames(browserFamily, platform).map(name => name.toLowerCase());
    return output
        .split(/\r?\n/)
        .map(line => line.trim())
        .flatMap(line => {
            const match = /^(\d+)\s+(.+)$/.exec(line);
            if (!match || !processNames.some(name => match[2].toLowerCase().includes(name))) {
                return [];
            }
            return [{ pid: Number(match[1]), commandLine: match[2] }];
        });
}

async function stopBrowserProcess(processId: number, platform: NodeJS.Platform): Promise<void> {
    if (platform === 'win32') {
        await execFileText('taskkill', ['/PID', String(processId), '/T']).catch(() => undefined);
        return;
    }
    try {
        process.kill(processId, 'SIGTERM');
    } catch (error: unknown) {
        if (!hasErrorCode(error, 'ESRCH')) {
            throw error;
        }
    }
}

function readUserDataDirArgument(commandLine: string): string | null {
    const tokens = tokenizeCommandLine(commandLine);
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '--user-data-dir') {
            return tokens[index + 1] ?? null;
        }

        if (token.startsWith('--user-data-dir=')) {
            return token.slice('--user-data-dir='.length);
        }
    }

    return null;
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
            pushToken(tokens, current);
            current = '';
        } else {
            current += char;
        }
    }

    pushToken(tokens, current);
    return tokens;
}

function pushToken(tokens: string[], token: string): void {
    if (token) {
        tokens.push(token);
    }
}

function normalizeProcessPath(filePath: string, platform: NodeJS.Platform): string {
    const platformPath = platform === 'win32' ? path.win32 : path.posix;
    const normalized = platformPath.resolve(filePath).replace(/\\/g, '/').replace(/\/+$/g, '');
    return isCaseInsensitivePlatform(platform) ? normalized.toLowerCase() : normalized;
}

function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
    return platform === 'win32' || platform === 'darwin';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function execFileText(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, (error, stdout) => {
            if (error) {
                reject(new Error(error.message));
                return;
            }

            resolve(stdout);
        });
    });
}
