import * as path from 'path';
import { canCarryWorkingDirectoryChange, resolveWorkingDirectoryChange } from './commandWorkingDirectory';
import type { CommandRiskContext, CommandRiskIssue } from './commandRiskTypes';
import type { ParsedShellCommand, ParsedShellSegment } from './shellCommandParser';
import { isNonFileSystemPowerShellProvider, isShellControlOption } from './powershellPathPolicy';
import { assessRecursiveRemoveTargets } from './recursiveRemovalPolicy';
import { getPathModule, isInsideDirectory, isUnverifiableMsysAbsolutePath } from './shellPathSemantics';

const POSIX_PATH_COMMANDS = new Set([
    'cat',
    'chmod',
    'chown',
    'cp',
    'find',
    'less',
    'mkdir',
    'more',
    'mv',
    'rm',
    'tar',
    'tee',
    'touch',
    'unzip',
    'zip'
]);

const POWERSHELL_PATH_COMMANDS = new Set([
    'add-content',
    'cat',
    'copy',
    'copy-item',
    'cp',
    'del',
    'dir',
    'erase',
    'gc',
    'gci',
    'get-childitem',
    'get-content',
    'ls',
    'move',
    'move-item',
    'mv',
    'new-item',
    'ni',
    'rd',
    'remove-item',
    'ri',
    'rm',
    'rmdir',
    'set-content',
    'tee',
    'tee-object',
    'type'
]);

const REMOVE_COMMANDS = new Set(['rm', 'remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase']);
const COMMON_PATH_OPTIONS = new Set(['--cwd', '--dir', '--directory', '--file', '--out-dir', '--output', '--path', '--prefix']);
const EMPTY_PATH_OPTIONS = new Set<string>();
const POSIX_COMMAND_PATH_OPTIONS = new Map<string, ReadonlySet<string>>([
    // POSIX short options are case-sensitive; these commands use uppercase -C for directory paths.
    ['git', new Set(['-C'])],
    ['make', new Set(['-C'])],
    ['tar', new Set(['-C'])]
]);
const POWERSHELL_PATH_OPTIONS = new Set([
    '-destination',
    '-filepath',
    '-literalpath',
    '-out-file',
    '-outfile',
    '-path',
    '-target',
    '-workingdirectory'
]);

type PathCheckMode = 'obvious' | 'argument';

export function assessPathPolicy(parsed: ParsedShellCommand, context: CommandRiskContext = {}): CommandRiskIssue[] {
    const issues: CommandRiskIssue[] = [];
    let activeContext = context;
    for (const segment of parsed.segments) {
        issues.push(...assessSegmentPathPolicy(parsed, segment, activeContext));
        const directoryChange = resolveWorkingDirectoryChange(parsed, segment, activeContext);
        if (directoryChange.changed && canCarryWorkingDirectoryChange(parsed, segment)) {
            activeContext = { ...activeContext, cwd: directoryChange.cwd };
        }
    }

    return issues;
}

function assessSegmentPathPolicy(
    parsed: ParsedShellCommand,
    segment: ParsedShellSegment,
    context: CommandRiskContext
): CommandRiskIssue[] {
    const issues: CommandRiskIssue[] = [];
    issues.push(...assessRedirections(parsed, segment, context));
    issues.push(...assessPathOptions(parsed, segment, context));
    issues.push(...assessPathCommandArguments(parsed, segment, context));
    issues.push(...assessObviousPathEscapes(parsed, segment, context));
    return issues;
}

function assessPathCommandArguments(
    parsed: ParsedShellCommand,
    segment: ParsedShellSegment,
    context: CommandRiskContext
): CommandRiskIssue[] {
    if (!isPathCommand(parsed, segment.commandName)) {
        return [];
    }

    const args = collectCommandPathArgs(parsed, segment);
    const issues = args.flatMap(arg => assessPathToken(arg, parsed, context, 'argument'));
    if (!isRecursiveRemove(segment)) {
        return issues;
    }

    const recursiveTargets = [...args, ...collectPathOptionValues(parsed, segment)];
    return issues.concat(assessRecursiveRemoveTargets(recursiveTargets, target => {
        const candidate = normalizePathCandidate(target);
        return isDynamicPathReference(candidate) || isPathInsideWorkspace(candidate, parsed, context);
    }));
}

function assessObviousPathEscapes(
    parsed: ParsedShellCommand,
    segment: ParsedShellSegment,
    context: CommandRiskContext
): CommandRiskIssue[] {
    return segment.args.flatMap(arg => {
        if (!isObviousPathEscape(arg, parsed)) {
            return [];
        }

        return assessPathToken(arg, parsed, context, 'obvious');
    });
}

function assessPathOptions(
    parsed: ParsedShellCommand,
    segment: ParsedShellSegment,
    context: CommandRiskContext
): CommandRiskIssue[] {
    return collectPathOptionValues(parsed, segment).flatMap(value => assessPathToken(value, parsed, context, 'argument'));
}

function assessRedirections(
    parsed: ParsedShellCommand,
    segment: ParsedShellSegment,
    context: CommandRiskContext
): CommandRiskIssue[] {
    return collectRedirectionTargets(segment.words).flatMap(target => {
        if (isSafeRedirectionTarget(target, parsed)) {
            return [];
        }

        return assessPathToken(target, parsed, context, 'argument');
    });
}

function collectCommandPathArgs(parsed: ParsedShellCommand, segment: ParsedShellSegment): string[] {
    const pathArgs: string[] = [];
    let afterOptions = false;
    const args = segment.args;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--') {
            // Option parsing stops here; following values are positional path arguments for path commands.
            afterOptions = true;
            continue;
        }
        const optionName = getPathOptionName(arg, parsed, segment.commandName);
        if (optionName) {
            index += optionName.inline ? 0 : 1;
            continue;
        }
        if (isCommandPathArg(arg, afterOptions)) {
            pathArgs.push(arg);
        }
    }

    return pathArgs;
}

function isCommandPathArg(arg: string, afterOptions: boolean): boolean {
    if (!arg) {
        return false;
    }
    if (afterOptions) {
        return true;
    }

    return !arg.startsWith('-');
}

function collectPathOptionValues(parsed: ParsedShellCommand, segment: ParsedShellSegment): string[] {
    const values: string[] = [];
    for (let index = 0; index < segment.args.length; index++) {
        const arg = segment.args[index];
        if (arg === '--') {
            // collectCommandPathArgs handles positional values after the end-of-options marker.
            break;
        }

        const next = segment.args[index + 1];
        appendPathOptionValue(values, arg, next, parsed, segment.commandName);
    }

    return values;
}

function appendPathOptionValue(
    values: string[],
    arg: string,
    next: string | undefined,
    parsed: ParsedShellCommand,
    commandName: string
): void {
    const optionName = getPathOptionName(arg, parsed, commandName);
    if (!optionName) {
        return;
    }

    if (!optionName.inline && next) {
        values.push(next);
    } else if (optionName.inline) {
        values.push(optionName.value);
    }
}

function collectRedirectionTargets(words: string[]): string[] {
    const targets: string[] = [];
    for (let index = 0; index < words.length; index++) {
        const word = words[index];
        const inlineTarget = inlineRedirectionTarget(word);
        if (inlineTarget) {
            targets.push(inlineTarget);
            continue;
        }
        if (isRedirectionOperator(word) && words[index + 1]) {
            targets.push(words[index + 1]);
        }
    }

    return targets;
}

function inlineRedirectionTarget(word: string): string | null {
    const match = /^(?:\d*)>{1,2}(.+)$/.exec(word) ?? /^(?:\d*)<(.+)$/.exec(word);
    if (!match || match[1].startsWith('&')) {
        return null;
    }

    return match[1];
}

function assessPathToken(
    token: string,
    parsed: ParsedShellCommand,
    context: CommandRiskContext,
    mode: PathCheckMode
): CommandRiskIssue[] {
    const candidate = normalizePathCandidate(token);
    if (!candidate || shouldSkipPathCandidate(candidate, parsed, mode)) {
        return [];
    }
    if (isDynamicPathReference(candidate)) {
        return [requiresConfirmation(`Dynamic path argument "${candidate}" cannot be verified against the configured command roots.`)];
    }
    if (parsed.shellKind === 'powershell' && isNonFileSystemPowerShellProvider(candidate)) {
        return [blocked(`PowerShell provider path "${candidate}" is outside the filesystem workspace policy.`)];
    }
    if (!looksPathLike(candidate, parsed) && mode === 'obvious') {
        return [];
    }

    return isPathInsideWorkspace(candidate, parsed, context)
        ? []
        : [requiresConfirmation(`Path argument "${candidate}" resolves outside the configured command roots.`)];
}

function isPathInsideWorkspace(
    candidate: string,
    parsed: ParsedShellCommand,
    context: CommandRiskContext
): boolean {
    if (!context.workspaceRoot) {
        return !isObviousPathEscape(candidate, parsed);
    }
    if (!context.cwd || isUnverifiableMsysAbsolutePath(candidate, parsed.shellKind, context.platform)) {
        return false;
    }

    const pathModule = getPathModule(context.platform);
    const resolved = resolveCandidatePath(candidate, context.cwd, parsed, context.platform);
    const allowedRoots = [context.workspaceRoot, ...(context.allowedRoots ?? [])]
        .map(root => pathModule.resolve(pathModule.normalize(root)));
    return allowedRoots.some(root => isInsideDirectory(resolved, root, pathModule));
}

function resolveCandidatePath(
    candidate: string,
    cwd: string,
    parsed: ParsedShellCommand,
    platform: NodeJS.Platform | undefined
): string {
    const withoutGlob = stripGlobTail(candidate, parsed);
    const pathModule = getPathModule(platform);
    return pathModule.isAbsolute(withoutGlob) || /^[a-z]:[\\/]/i.test(withoutGlob)
        ? pathModule.resolve(pathModule.normalize(withoutGlob))
        : pathModule.resolve(cwd, pathModule.normalize(withoutGlob));
}

function stripGlobTail(candidate: string, parsed: ParsedShellCommand): string {
    const globIndex = candidate.search(/[*?]/);
    if (globIndex === -1) {
        return candidate;
    }

    const prefix = candidate.slice(0, globIndex);
    const segmentPattern = parsed.shellKind === 'posix' ? /\/[^/]*$/ : /[\\/][^\\/]*$/;
    return prefix.replace(segmentPattern, '') || '.';
}

function isPathCommand(parsed: ParsedShellCommand, commandName: string): boolean {
    return parsed.shellKind === 'powershell'
        ? POWERSHELL_PATH_COMMANDS.has(commandName)
        : POSIX_PATH_COMMANDS.has(commandName);
}

function isRecursiveRemove(segment: ParsedShellSegment): boolean {
    return REMOVE_COMMANDS.has(segment.commandName) && segment.args.some(isRecursiveFlag);
}

function isRecursiveFlag(arg: string): boolean {
    const lower = arg.toLowerCase();
    return lower === '--recursive' || lower === '-recurse' || lower === '-recursive' || /^-[^-]*r/i.test(arg);
}

function normalizePathCandidate(token: string): string {
    return token.trim().replace(/^file:\/\//i, '');
}

function shouldSkipPathCandidate(candidate: string, parsed: ParsedShellCommand, mode: PathCheckMode): boolean {
    return candidate === ''
        || candidate === '-'
        || candidate === '--'
        || isShellControlOption(candidate)
        || isNonFileUrl(candidate)
        || (mode === 'obvious' && !isObviousPathEscape(candidate, parsed));
}

function isObviousPathEscape(candidate: string, parsed: ParsedShellCommand): boolean {
    return startsWithParentPath(candidate, parsed)
        || startsWithHomePath(candidate, parsed)
        || isAbsolutePath(candidate, parsed)
        || isHomeEnvironmentPath(candidate);
}

function looksPathLike(candidate: string, parsed: ParsedShellCommand): boolean {
    return candidate === '.'
        || candidate === '..'
        || candidate.includes('/')
        || (parsed.shellKind === 'powershell' && candidate.includes('\\'))
        || candidate.startsWith('~')
        || /^[a-z]:/i.test(candidate);
}

function startsWithParentPath(candidate: string, parsed: ParsedShellCommand): boolean {
    return candidate === '..'
        || candidate.startsWith('../')
        || candidate.includes('/../')
        || (parsed.shellKind === 'powershell' && (
            candidate.startsWith('..\\') ||
            candidate.includes('\\..\\')
        ));
}

function startsWithHomePath(candidate: string, parsed: ParsedShellCommand): boolean {
    return candidate === '~' ||
        candidate.startsWith('~/') ||
        (parsed.shellKind === 'powershell' && candidate.startsWith('~\\'));
}

function isHomeEnvironmentPath(candidate: string): boolean {
    const lower = candidate.toLowerCase();
    return lower.startsWith('$home')
        || lower.startsWith('${home}')
        || lower.startsWith('$env:userprofile')
        || lower.startsWith('%userprofile%')
        || lower.startsWith('%homepath%');
}

function isAbsolutePath(candidate: string, parsed: ParsedShellCommand): boolean {
    return parsed.shellKind === 'posix'
        ? candidate.startsWith('/') || /^[a-z]:[\\/]/i.test(candidate)
        : path.isAbsolute(candidate) || /^[a-z]:[\\/]/i.test(candidate);
}

function isDynamicPathReference(candidate: string): boolean {
    return candidate.startsWith('$') || candidate.startsWith('%');
}

function isNonFileUrl(candidate: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && !candidate.toLowerCase().startsWith('file://');
}

function isRedirectionOperator(word: string): boolean {
    return /^(?:\d*)>{1,2}$/.test(word) || /^(?:\d*)<$/.test(word);
}

const isSafeRedirectionTarget = (target: string, parsed: ParsedShellCommand): boolean =>
    parsed.shellKind === 'posix' && normalizePathCandidate(target) === '/dev/null';

function getPathOptionName(
    arg: string,
    parsed: ParsedShellCommand,
    commandName: string
): { inline: false } | { inline: true; value: string } | null {
    const separatorIndex = parsed.shellKind === 'powershell' ? arg.search(/[:=]/) : arg.indexOf('=');
    if (separatorIndex > 0) {
        const option = arg.slice(0, separatorIndex);
        return isPathOptionName(option, parsed, commandName) ? { inline: true, value: arg.slice(separatorIndex + 1) } : null;
    }

    if (isPathOptionName(arg, parsed, commandName)) {
        return { inline: false };
    }

    const inlineShort = getInlineShortPathOption(arg, parsed, commandName);
    return inlineShort ? { inline: true, value: inlineShort } : null;
}

function getInlineShortPathOption(arg: string, parsed: ParsedShellCommand, commandName: string): string | null {
    if (parsed.shellKind !== 'posix' || !getPosixCommandPathOptions(commandName).has('-C')) {
        return null;
    }

    return arg.startsWith('-C') && arg.length > 2 ? arg.slice(2) : null;
}

function isPathOptionName(value: string, parsed: ParsedShellCommand, commandName: string): boolean {
    if (COMMON_PATH_OPTIONS.has(value.toLowerCase())) {
        return true;
    }
    if (parsed.shellKind === 'powershell') {
        return value.length > 1 && [...POWERSHELL_PATH_OPTIONS].some(option => option.startsWith(value.toLowerCase()));
    }

    return getPosixCommandPathOptions(commandName).has(value);
}

function getPosixCommandPathOptions(commandName: string): ReadonlySet<string> {
    return POSIX_COMMAND_PATH_OPTIONS.get(commandName) ?? EMPTY_PATH_OPTIONS;
}

const blocked = (reason: string): CommandRiskIssue => ({ level: 'blocked', reason });
const requiresConfirmation = (reason: string): CommandRiskIssue => ({ level: 'requires_confirmation', reason });
