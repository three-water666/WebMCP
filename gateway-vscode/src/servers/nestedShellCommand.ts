import type { TerminalShellKind } from './terminalProfiles';
import { matchesPowerShellSwitch } from './powershellSwitch';
import type { ParsedShellCommand, ParsedShellSegment } from './shellCommandParser';

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'fish']);
const POWERSHELLS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

export type LiteralNestedShellCommand = {
    command: string;
    shellKind: TerminalShellKind;
};

export function collectLiteralNestedShellCommands(
    parsed: ParsedShellCommand
): LiteralNestedShellCommand[] {
    return parsed.segments
        .map(findLiteralNestedShellCommand)
        .filter((command): command is LiteralNestedShellCommand => command !== null);
}

function findLiteralNestedShellCommand(
    segment: ParsedShellSegment
): LiteralNestedShellCommand | null {
    if (POSIX_SHELLS.has(segment.commandName)) {
        return findCommandAfterFlag(segment.args, isPosixCommandFlag, 'posix');
    }
    if (POWERSHELLS.has(segment.commandName)) {
        return findPowerShellCommandAfterFlag(segment.args);
    }

    return null;
}

function findPowerShellCommandAfterFlag(args: string[]): LiteralNestedShellCommand | null {
    const flagIndex = args.findIndex(isPowerShellCommandFlag);
    const command = flagIndex >= 0 ? args.slice(flagIndex + 1).join(' ').trim() : '';
    return command ? { command, shellKind: 'powershell' } : null;
}

function findCommandAfterFlag(
    args: string[],
    isCommandFlag: (arg: string) => boolean,
    shellKind: TerminalShellKind
): LiteralNestedShellCommand | null {
    const flagIndex = args.findIndex(isCommandFlag);
    const command = flagIndex >= 0 ? args[flagIndex + 1]?.trim() : '';
    return command ? { command, shellKind } : null;
}

function isPosixCommandFlag(arg: string): boolean {
    return arg === '--command' || /^-[^-]*c/.test(arg);
}

function isPowerShellCommandFlag(arg: string): boolean {
    return matchesPowerShellSwitch(arg, 'command');
}
