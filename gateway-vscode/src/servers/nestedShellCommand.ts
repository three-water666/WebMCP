import type { TerminalShellKind } from './terminalProfiles';
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
        return findCommandAfterFlag(segment.args, isPowerShellCommandFlag, 'powershell');
    }

    return null;
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
    const lower = arg.toLowerCase();
    if (!lower.startsWith('-') && !lower.startsWith('/')) {
        return false;
    }

    const switchName = lower.slice(1).split(':', 1)[0];
    return switchName.length > 0 && 'command'.startsWith(switchName);
}
