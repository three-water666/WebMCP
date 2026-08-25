import type { CommandRiskIssue } from './commandRiskTypes';
import type { ParsedShellCommand, ParsedShellSegment } from './shellCommandParser';

const POSIX_BLOCKED_COMMANDS = new Map<string, string>([
    ['sudo', 'Privilege escalation with sudo is not allowed.'],
    ['su', 'Privilege escalation with su is not allowed.'],
    ['shutdown', 'System shutdown commands are not allowed.'],
    ['reboot', 'System reboot commands are not allowed.'],
    ['halt', 'System shutdown commands are not allowed.'],
    ['poweroff', 'System shutdown commands are not allowed.'],
    ['diskpart', 'Disk partitioning commands are not allowed.'],
    ['format', 'Disk formatting commands are not allowed.'],
    ['reg', 'Windows registry commands are not allowed.'],
    ['sc', 'Windows service control commands are not allowed.'],
    ['netsh', 'Network configuration commands are not allowed.'],
    ['mkfs', 'Filesystem formatting commands are not allowed.'],
    ['dd', 'Raw disk copy commands are not allowed.']
]);

const POWERSHELL_BLOCKED_COMMANDS = new Map<string, string>([
    ['diskpart', 'Disk partitioning commands are not allowed.'],
    ['format', 'Disk formatting commands are not allowed.'],
    ['reg', 'Windows registry commands are not allowed.'],
    ['reg.exe', 'Windows registry commands are not allowed.'],
    ['sc', 'Windows service control commands are not allowed.'],
    ['sc.exe', 'Windows service control commands are not allowed.'],
    ['netsh', 'Network configuration commands are not allowed.'],
    ['shutdown', 'System shutdown commands are not allowed.'],
    ['shutdown.exe', 'System shutdown commands are not allowed.'],
    ['stop-computer', 'System shutdown commands are not allowed.'],
    ['restart-computer', 'System restart commands are not allowed.'],
    ['set-executionpolicy', 'Changing PowerShell execution policy is not allowed.'],
    ['invoke-expression', 'Invoke-Expression is not allowed.'],
    ['iex', 'Invoke-Expression is not allowed.']
]);

const POSIX_SHELL_COMMANDS = new Set(['bash', 'sh', 'zsh', 'fish']);
const POWERSHELL_COMMANDS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const CMD_COMMANDS = new Set(['cmd', 'cmd.exe']);
const POWERSHELL_EVAL_COMMANDS = new Set(['invoke-expression', 'iex']);

const POSIX_INTERPRETER_EVAL_FLAGS = new Map<string, string[]>([
    ['python', ['-c']],
    ['python3', ['-c']],
    ['py', ['-c']],
    ['node', ['-e', '--eval', '-p', '--print']],
    ['deno', ['eval']],
    ['ruby', ['-e']],
    ['perl', ['-e']],
    ['php', ['-r']],
    ['bun', ['eval', '-e']]
]);

const POWERSHELL_INTERPRETER_EVAL_FLAGS = new Map<string, string[]>([
    ['python', ['-c']],
    ['python.exe', ['-c']],
    ['python3', ['-c']],
    ['py', ['-c']],
    ['node', ['-e', '--eval', '-p', '--print']],
    ['node.exe', ['-e', '--eval', '-p', '--print']],
    ['bun', ['eval', '-e']]
]);

export function assessCommandPolicy(parsed: ParsedShellCommand): CommandRiskIssue[] {
    return [
        ...assessDynamicSyntaxPolicy(parsed),
        ...parsed.segments.flatMap(segment => assessSegmentPolicy(parsed, segment))
    ];
}

function assessDynamicSyntaxPolicy(parsed: ParsedShellCommand): CommandRiskIssue[] {
    const command = parsed.segments.map(segment => segment.raw).join(' ');
    if (parsed.shellKind === 'posix' && (/\$\(/.test(command) || /`[^`]+`/.test(command))) {
        return [requiresConfirmation('POSIX command substitution requires explicit approval.')];
    }

    if (parsed.shellKind === 'powershell' && hasDynamicPowerShellSyntax(command)) {
        return [requiresConfirmation('Dynamic PowerShell syntax requires explicit approval.')];
    }

    return [];
}

function hasDynamicPowerShellSyntax(command: string): boolean {
    return /(?:^|\s)&\s*\$/m.test(command)
        || /\$\(/.test(command)
        || /(?:^|[;|]\s*)[&.]?\s*\{/m.test(command)
        || /\[[^\]]+\]::/.test(command)
        || /(?:^|\s)@[A-Za-z_][A-Za-z0-9_]*/.test(command);
}

function assessSegmentPolicy(parsed: ParsedShellCommand, segment: ParsedShellSegment): CommandRiskIssue[] {
    const pipeIssue = assessPipePolicy(parsed, segment);
    if (pipeIssue) {
        return [pipeIssue];
    }

    if (!segment.commandName) {
        return [];
    }

    return parsed.shellKind === 'powershell'
        ? assessPowerShellSegmentPolicy(segment)
        : assessPosixSegmentPolicy(segment);
}

function assessPipePolicy(parsed: ParsedShellCommand, segment: ParsedShellSegment): CommandRiskIssue | null {
    if (segment.operatorBefore !== '|') {
        return null;
    }

    if (parsed.shellKind === 'powershell' && POWERSHELL_EVAL_COMMANDS.has(segment.commandName)) {
        return blocked('Piping downloaded or generated content into Invoke-Expression is not allowed.');
    }
    if (parsed.shellKind === 'posix' && POSIX_SHELL_COMMANDS.has(segment.commandName)) {
        return blocked('Piping data into a shell interpreter is not allowed.');
    }

    return null;
}

function assessPosixSegmentPolicy(segment: ParsedShellSegment): CommandRiskIssue[] {
    const blockedReason = POSIX_BLOCKED_COMMANDS.get(segment.commandName);
    if (blockedReason) {
        return [blocked(blockedReason)];
    }

    const shellIssue = assessNestedPosixShell(segment);
    if (shellIssue) {
        return [shellIssue];
    }

    return [
        ...assessInterpreterEval(segment.commandName, segment.args, POSIX_INTERPRETER_EVAL_FLAGS),
        ...assessSharedCommandPolicy(segment.commandName, segment.args)
    ];
}

function assessPowerShellSegmentPolicy(segment: ParsedShellSegment): CommandRiskIssue[] {
    const blockedReason = POWERSHELL_BLOCKED_COMMANDS.get(segment.commandName);
    if (blockedReason) {
        return [blocked(blockedReason)];
    }

    const shellIssue = assessNestedPowerShell(segment);
    if (shellIssue) {
        return [shellIssue];
    }

    return [
        ...assessInterpreterEval(segment.commandName, segment.args, POWERSHELL_INTERPRETER_EVAL_FLAGS),
        ...assessSharedCommandPolicy(segment.commandName, segment.args)
    ];
}

function assessNestedPosixShell(segment: ParsedShellSegment): CommandRiskIssue | null {
    if (POSIX_SHELL_COMMANDS.has(segment.commandName) && hasShellEvalFlag(segment.args)) {
        return requiresConfirmation(`Nested shell evaluation with ${segment.commandName} requires explicit approval.`);
    }
    if (POWERSHELL_COMMANDS.has(segment.commandName) && hasEncodedPowerShellCommandFlag(segment.args)) {
        return blocked(`Encoded PowerShell evaluation with ${segment.commandName} is not allowed.`);
    }
    if (POWERSHELL_COMMANDS.has(segment.commandName) && hasPowerShellCommandFlag(segment.args)) {
        return requiresConfirmation(`Nested PowerShell evaluation with ${segment.commandName} requires explicit approval.`);
    }
    if (CMD_COMMANDS.has(segment.commandName) && hasCmdCommandFlag(segment.args)) {
        return requiresConfirmation('Nested cmd.exe evaluation requires explicit approval.');
    }

    return null;
}

function assessNestedPowerShell(segment: ParsedShellSegment): CommandRiskIssue | null {
    if (POWERSHELL_COMMANDS.has(segment.commandName) && hasEncodedPowerShellCommandFlag(segment.args)) {
        return blocked(`Encoded PowerShell evaluation with ${segment.commandName} is not allowed.`);
    }
    if (POWERSHELL_COMMANDS.has(segment.commandName) && hasPowerShellCommandFlag(segment.args)) {
        return requiresConfirmation(`Nested PowerShell evaluation with ${segment.commandName} requires explicit approval.`);
    }
    if (CMD_COMMANDS.has(segment.commandName) && hasCmdCommandFlag(segment.args)) {
        return requiresConfirmation('Nested cmd.exe evaluation requires explicit approval.');
    }

    return null;
}

function assessSharedCommandPolicy(commandName: string, args: string[]): CommandRiskIssue[] {
    if (commandName === 'git') {
        return assessGit(args);
    }
    if (commandName === 'find' && args.includes('-delete')) {
        return [requiresConfirmation('find -delete can remove multiple files.')];
    }
    if (commandName === 'chmod' && hasRecursiveFlag(args) && args.includes('777')) {
        return [requiresConfirmation('Recursive chmod 777 changes permissions for multiple files.')];
    }
    if (commandName === 'chown' && hasRecursiveFlag(args)) {
        return [requiresConfirmation('Recursive chown changes ownership for multiple files.')];
    }

    return [];
}

function assessGit(args: string[]): CommandRiskIssue[] {
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === 'reset' && args.some(arg => arg.toLowerCase() === '--hard')) {
        return [requiresConfirmation('git reset --hard can discard uncommitted changes.')];
    }
    if (subcommand === 'clean' && hasCombinedFlags(args, ['f', 'd', 'x'])) {
        return [requiresConfirmation('git clean -fdx can permanently remove untracked and ignored files.')];
    }
    if (subcommand === 'push' && args.some(isForcePushFlag)) {
        return [requiresConfirmation('Force-pushing can overwrite remote branch history.')];
    }

    return [];
}

function assessInterpreterEval(
    commandName: string,
    args: string[],
    evalFlags: Map<string, string[]>
): CommandRiskIssue[] {
    const flags = evalFlags.get(commandName);
    if (!flags || !args.some(arg => flags.includes(arg.toLowerCase()))) {
        return [];
    }

    return [requiresConfirmation(`Inline code execution with ${commandName} requires explicit approval.`)];
}

function hasRecursiveFlag(args: string[]): boolean {
    return args.some(arg => arg === '--recursive' || /^-[^-]*[rR]/.test(arg));
}

function hasCombinedFlags(args: string[], requiredFlags: string[]): boolean {
    const flagChars = args
        .filter(arg => /^-[A-Za-z]+$/.test(arg))
        .join('')
        .toLowerCase();

    return requiredFlags.every(flag => flagChars.includes(flag));
}

function hasShellEvalFlag(args: string[]): boolean {
    return args.some(arg => /^-[^-]*c/.test(arg) || arg === '--command');
}

function hasPowerShellCommandFlag(args: string[]): boolean {
    return args.some(arg => matchesPowerShellSwitch(arg, 'command'));
}

function hasEncodedPowerShellCommandFlag(args: string[]): boolean {
    return args.some(arg => matchesPowerShellSwitch(arg, 'encodedcommand'));
}

function matchesPowerShellSwitch(arg: string, fullName: string): boolean {
    const lower = arg.toLowerCase();
    if (!lower.startsWith('-') && !lower.startsWith('/')) {
        return false;
    }

    const switchName = lower.slice(1).split(':', 1)[0];
    return switchName.length > 0 && fullName.startsWith(switchName);
}

function hasCmdCommandFlag(args: string[]): boolean {
    return args.some(arg => arg.toLowerCase() === '/c');
}

function isForcePushFlag(arg: string): boolean {
    const lower = arg.toLowerCase();
    return lower === '--force' || lower === '-f' || lower.startsWith('--force-with-lease');
}

function blocked(reason: string): CommandRiskIssue {
    return { level: 'blocked', reason };
}

function requiresConfirmation(reason: string): CommandRiskIssue {
    return { level: 'requires_confirmation', reason };
}
