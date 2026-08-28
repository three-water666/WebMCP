import type {
    LocalTool,
    ToolDefinition,
    ToolExecutionContext,
    ToolRiskPreflight
} from './types';
import { errorResult, jsonResult } from './result';
import { WORKSPACE_COMMAND_PATH_DESCRIPTION, resolveWorkspaceRelativeDirectory } from './workspacePath';
import { normalizeShellCommand } from '../servers/commandShell';
import { formatCommandRiskAssessment } from '../servers/commandRisk';
import {
    describeTerminalProfiles,
    listTerminalProfiles,
    resolveTerminalProfile,
    type WebcodeTerminalProfile
} from '../servers/terminalProfiles';
import { getErrorMessage } from '../gateway/errorUtils';
import { assessCommandToolRisk } from '../servers/commandToolRisk';

export const runInTerminalTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'run_in_terminal',
        description: 'Run a command in a real visible VS Code integrated terminal.',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', minLength: 1, description: 'Command to execute using the selected terminal profile syntax.' },
                path: { type: 'string', description: WORKSPACE_COMMAND_PATH_DESCRIPTION },
                profile: { type: 'string', description: 'Terminal profile id to use. Dynamic tool descriptions list available profiles.' },
                auto_focus: { type: 'boolean', description: 'Focus the terminal after sending the command. Default: true.', default: true }
            },
            required: ['command']
        }
    },
    getDefinition(context) {
        return createRunInTerminalDefinition(context.commandShellPath);
    },
    async assessRisk(args, context) {
        return (await resolveRunInTerminalRequest(args, context)).risk;
    },
    async execute(args, context) {
        if (!context.workspaceRoot) {
            return errorResult('Security Error: A VS Code workspace folder is required to run terminal commands.');
        }

        try {
            const request = await resolveRunInTerminalRequest(args, context);
            if (request.risk.assessment.level === 'blocked') {
                return errorResult(`Security Error: ${formatCommandRiskAssessment(request.risk.assessment)}`);
            }
            if (request.risk.assessment.level === 'requires_confirmation'
                && context.approvedCommandFingerprint !== request.risk.fingerprint) {
                return errorResult(`Approval Required: ${formatCommandRiskAssessment(request.risk.assessment)}`);
            }
            const session = context.terminalSessionManager.createSession({
                commandLine: request.commandLine,
                cwd: request.absolutePath,
                path: request.commandPath,
                env: { ...process.env },
                profile: request.profile,
                autoFocus: args.auto_focus !== false
            });

            return jsonResult({
                session_id: session.id,
                name: session.name,
                status: session.status,
                path: session.path,
                command: session.command,
                profile: session.profile,
                shell: {
                    id: request.profile.id,
                    syntax: request.profile.syntax
                }
            });
        } catch (error: unknown) {
            return errorResult(`Error: ${getErrorMessage(error)}\n${describeRunInTerminalPolicy(context.commandShellPath)}`);
        }
    }
};

type ResolvedRunInTerminalRequest = {
    absolutePath: string;
    commandLine: string;
    commandPath: string;
    profile: WebcodeTerminalProfile;
    risk: ToolRiskPreflight;
};

async function resolveRunInTerminalRequest(
    args: Record<string, unknown>,
    context: ToolExecutionContext
): Promise<ResolvedRunInTerminalRequest> {
    if ('cwd' in args) {
        throw new Error('Parameter "cwd" has been removed. Use workspace-relative "path" instead.');
    }
    if (!context.workspaceRoot) {
        throw new Error('A VS Code workspace folder is required to run terminal commands.');
    }

    const commandLine = normalizeShellCommand(args.command);
    const profile = resolveTerminalProfile(args.profile, {
        platform: process.platform,
        env: process.env,
        configuredCommandShellPath: context.commandShellPath
    });
    const directory = await resolveWorkspaceRelativeDirectory(context.workspaceRoot, args.path ?? '.');
    const risk = assessCommandToolRisk({
        command: commandLine,
        commandPath: directory.relativePath,
        profileId: `${profile.id}\0${profile.resolvedPath ?? profile.shellPath ?? ''}`,
        shellKind: profile.shellKind,
        toolName: 'run_in_terminal',
        riskContext: {
            workspaceRoot: context.workspaceRoot,
            cwd: directory.absolutePath,
            allowedRoots: context.commandAllowedRoots,
            platform: process.platform
        }
    });

    return {
        absolutePath: directory.absolutePath,
        commandLine,
        commandPath: directory.relativePath,
        profile,
        risk
    };
}

function createRunInTerminalDefinition(commandShellPath?: string): ToolDefinition {
    const profiles = listTerminalProfiles({
        platform: process.platform,
        env: process.env,
        configuredCommandShellPath: commandShellPath
    });
    const profileIds = profiles.map(profile => profile.id).join(', ') || 'none';
    const defaultProfile = profiles[0]?.id;

    return {
        name: 'run_in_terminal',
        description: [
            'Run a command in a real visible VS Code integrated terminal.',
            'Returns a session_id immediately; use terminal_session to read captured output or interrupt it later.',
            'Command output and exit codes are captured when VS Code shell integration is available.',
            'Use Git Bash/POSIX syntax with git-bash, and PowerShell syntax with pwsh or powershell.',
            'Available terminal profiles:',
            describeTerminalProfiles(profiles)
        ].join('\n'),
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', minLength: 1, description: 'Command to execute using the selected terminal profile syntax.' },
                path: { type: 'string', description: WORKSPACE_COMMAND_PATH_DESCRIPTION },
                profile: {
                    type: 'string',
                    description: `Terminal profile id to use. Available now: ${profileIds}. Default: ${defaultProfile ?? 'none'}.`
                },
                auto_focus: { type: 'boolean', description: 'Focus the terminal after sending the command. Default: true.', default: true }
            },
            required: ['command']
        }
    };
}

function describeRunInTerminalPolicy(commandShellPath?: string): string {
    const profiles = listTerminalProfiles({
        platform: process.platform,
        env: process.env,
        configuredCommandShellPath: commandShellPath
    });

    return `Policy: Choose one of the supported VS Code terminal profiles.\n${describeTerminalProfiles(profiles)}`;
}

