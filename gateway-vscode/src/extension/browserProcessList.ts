import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { BrowserFamily } from './isolatedBrowserProfiles';

export interface BrowserProcessInfo {
    pid: number;
    commandLine: string;
    executableName?: string;
    argv?: string[];
}

export async function listAllProcesses(platform: NodeJS.Platform): Promise<BrowserProcessInfo[]> {
    if (platform === 'win32') {
        return listWindowsProcesses();
    }
    if (platform === 'linux') {
        return listLinuxProcesses();
    }
    return listPsProcesses();
}

export function getBrowserFamily(
    processInfo: BrowserProcessInfo,
    platform: NodeJS.Platform
): BrowserFamily | null {
    return processInfo.executableName
        ? getBrowserFamilyForExecutableName(processInfo.executableName, platform)
        : null;
}

export function getBrowserFamilyForExecutableName(
    executableName: string,
    platform: NodeJS.Platform
): BrowserFamily | null {
    const platformPath = platform === 'win32' ? path.win32 : path.posix;
    const basename = platformPath.basename(executableName).toLowerCase();
    if (getBrowserProcessNames('edge', platform).some(name => basename === name.toLowerCase())) {
        return 'edge';
    }
    if (getBrowserProcessNames('chrome', platform).some(name => basename === name.toLowerCase())) {
        return 'chrome';
    }
    return null;
}

export function getBrowserProcessNames(browserFamily: BrowserFamily, platform: NodeJS.Platform): string[] {
    if (platform === 'win32') {
        return browserFamily === 'edge'
            ? ['msedge.exe']
            : ['chrome.exe', 'chrome-for-testing.exe', 'google-chrome-for-testing.exe', 'chromium.exe'];
    }
    if (platform === 'darwin') {
        return browserFamily === 'edge'
            ? ['Microsoft Edge', 'Microsoft Edge Helper']
            : [
                'Google Chrome',
                'Google Chrome Helper',
                'Google Chrome for Testing',
                'Google Chrome for Testing Helper',
                'Chromium',
                'Chromium Helper'
            ];
    }
    return browserFamily === 'edge'
        ? ['msedge', 'microsoft-edge', 'microsoft-edge-stable']
        : [
            'chrome',
            'chrome-for-testing',
            'google-chrome-for-testing',
            'google-chrome',
            'google-chrome-stable',
            'chromium',
            'chromium-browser'
        ];
}

export async function isBrowserProcessRunningFallback(
    browserFamily: BrowserFamily,
    platform: NodeJS.Platform
): Promise<boolean> {
    if (platform === 'win32') {
        const results = await Promise.all(getBrowserProcessNames(browserFamily, platform).map(async imageName => {
            try {
                const output = await executeFileText('tasklist', [
                    '/FI',
                    `IMAGENAME eq ${imageName}`,
                    '/FO',
                    'CSV',
                    '/NH'
                ]);
                return output.toLowerCase().includes(`"${imageName.toLowerCase()}"`);
            } catch {
                return false;
            }
        }));
        return results.some(Boolean);
    }

    const results = await Promise.all(getBrowserProcessNames(browserFamily, platform).map(async processName => {
        try {
            await executeFileText('pgrep', ['-x', processName]);
            return true;
        } catch {
            return false;
        }
    }));
    return results.some(Boolean);
}

export async function stopBrowserProcess(processId: number, platform: NodeJS.Platform): Promise<void> {
    if (platform === 'win32') {
        await executeFileText('taskkill', ['/PID', String(processId), '/T']).catch(() => undefined);
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

export function executeFileText(command: string, args: string[]): Promise<string> {
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

async function listWindowsProcesses(): Promise<BrowserProcessInfo[]> {
    const command = [
        '$ErrorActionPreference = "Stop";',
        '$processes = @(Get-CimInstance Win32_Process |',
        'Where-Object { $_.CommandLine } |',
        'Select-Object Name, ProcessId, CommandLine);',
        'ConvertTo-Json -InputObject $processes -Compress'
    ].join(' ');
    const output = await executeFileText('powershell.exe', ['-NoProfile', '-Command', command]);
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
        return [{
            pid: value.ProcessId,
            commandLine: value.CommandLine,
            executableName: typeof value.Name === 'string' ? value.Name : undefined
        }];
    });
}

async function listLinuxProcesses(): Promise<BrowserProcessInfo[]> {
    const entries = await fs.readdir('/proc', { withFileTypes: true });
    const processes = await Promise.all(entries
        .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map(entry => readLinuxProcess(Number(entry.name))));
    return processes.filter((processInfo): processInfo is BrowserProcessInfo => Boolean(processInfo));
}

async function readLinuxProcess(pid: number): Promise<BrowserProcessInfo | null> {
    try {
        const commandLineBuffer = await fs.readFile(`/proc/${pid}/cmdline`);
        const argv = commandLineBuffer.toString('utf8').split('\0').filter(Boolean);
        if (argv.length === 0) {
            return null;
        }
        return {
            pid,
            argv,
            commandLine: argv.join(' '),
            executableName: path.posix.basename(argv[0])
        };
    } catch {
        return null;
    }
}

async function listPsProcesses(): Promise<BrowserProcessInfo[]> {
    const [commandOutput, executableOutput] = await Promise.all([
        executeFileText('ps', ['-ww', '-axo', 'pid=,command=']),
        executeFileText('ps', ['-axo', 'pid=,comm='])
    ]);
    const executableNames = parsePsRows(executableOutput);
    return commandOutput
        .split(/\r?\n/)
        .map(line => line.trim())
        .flatMap(line => {
            const match = /^(\d+)\s+(.+)$/.exec(line);
            return match ? [{
                pid: Number(match[1]),
                commandLine: match[2],
                executableName: executableNames.get(Number(match[1]))
            }] : [];
        });
}

function parsePsRows(output: string): Map<number, string> {
    const rows = new Map<number, string>();
    for (const line of output.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (match) {
            rows.set(Number(match[1]), match[2].trim());
        }
    }
    return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
