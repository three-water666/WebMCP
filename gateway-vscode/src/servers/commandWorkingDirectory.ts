import type * as path from 'path';

import type { CommandRiskContext } from './commandRiskTypes';
import { isNonFileSystemPowerShellProvider } from './powershellPathPolicy';
import type { ParsedShellCommand, ParsedShellSegment } from './shellCommandParser';
import { getPathModule, isUnverifiableMsysAbsolutePath } from './shellPathSemantics';

const POSIX_DIRECTORY_CHANGE_COMMANDS = new Set(['cd', 'pushd']);
const POWERSHELL_DIRECTORY_CHANGE_COMMANDS = new Set([
    'cd',
    'chdir',
    'pop-location',
    'popd',
    'push-location',
    'pushd',
    'set-location',
    'sl'
]);
const POWERSHELL_DIRECTORY_PATH_OPTIONS = new Set(['-literalpath', '-path']);

export type WorkingDirectoryChange = {
    changed: boolean;
    cwd?: string;
};

export function resolveWorkingDirectoryChange(
    parsed: ParsedShellCommand,
    segment: ParsedShellSegment,
    context: CommandRiskContext
): WorkingDirectoryChange {
    if (!isDirectoryChangeCommand(parsed, segment.commandName)) {
        return { changed: false };
    }

    const target = getDirectoryChangeTarget(parsed, segment);
    if (!target || isUnverifiableTarget(target, parsed, context)) {
        return { changed: true };
    }

    const pathModule = getPathModule(context.platform);
    if (!context.cwd && !isAbsoluteTarget(target, parsed, pathModule)) {
        return { changed: true };
    }

    return {
        changed: true,
        cwd: pathModule.resolve(context.cwd ?? '.', pathModule.normalize(target))
    };
}

function isDirectoryChangeCommand(parsed: ParsedShellCommand, commandName: string): boolean {
    return parsed.shellKind === 'powershell'
        ? POWERSHELL_DIRECTORY_CHANGE_COMMANDS.has(commandName)
        : POSIX_DIRECTORY_CHANGE_COMMANDS.has(commandName);
}

function getDirectoryChangeTarget(parsed: ParsedShellCommand, segment: ParsedShellSegment): string | null {
    if (['popd', 'pop-location'].includes(segment.commandName)) {
        return null;
    }

    let afterOptions = false;
    for (let index = 0; index < segment.args.length; index++) {
        const arg = segment.args[index];
        if (arg === '--') {
            afterOptions = true;
            continue;
        }

        const optionValue = getPowerShellPathOptionValue(arg, segment.args[index + 1], parsed);
        if (optionValue !== null) {
            return optionValue;
        }
        if (afterOptions || !arg.startsWith('-')) {
            return arg;
        }
    }

    return null;
}

function getPowerShellPathOptionValue(
    arg: string,
    next: string | undefined,
    parsed: ParsedShellCommand
): string | null {
    if (parsed.shellKind !== 'powershell') {
        return null;
    }

    const equalsIndex = arg.indexOf('=');
    const option = (equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg).toLowerCase();
    if (!POWERSHELL_DIRECTORY_PATH_OPTIONS.has(option)) {
        return null;
    }

    return equalsIndex > 0 ? arg.slice(equalsIndex + 1) : (next ?? '');
}

function isUnverifiableTarget(
    target: string,
    parsed: ParsedShellCommand,
    context: CommandRiskContext
): boolean {
    const lower = target.toLowerCase();
    return target.startsWith('$')
        || target.startsWith('%')
        || lower === '~'
        || lower.startsWith('~/')
        || (parsed.shellKind === 'powershell' && lower.startsWith('~\\'))
        || (parsed.shellKind === 'powershell' && isNonFileSystemPowerShellProvider(target))
        || isUnverifiableMsysAbsolutePath(target, parsed.shellKind, context.platform);
}

function isAbsoluteTarget(
    target: string,
    parsed: ParsedShellCommand,
    pathModule: path.PlatformPath
): boolean {
    return pathModule.isAbsolute(target)
        || /^[a-z]:[\\/]/i.test(target)
        || (parsed.shellKind === 'posix' && target.startsWith('/'));
}
