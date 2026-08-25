import * as path from 'path';

import {
    describeTerminalProfiles,
    listTerminalProfiles,
    resolveTerminalProfile,
    type TerminalShellKind,
    type WebcodeTerminalProfile
} from './terminalProfiles';
import { resolveShellExecutionPlan } from './commandShell';

type BackgroundShellOptions = {
    configuredCommandShellPath?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
};

export type BackgroundShellExecutionPlan = {
    args: string[];
    file: string;
    profile: {
        id: string;
        path: string;
        shellKind: TerminalShellKind;
    };
};

export function resolveBackgroundShellExecutionPlan(
    command: string,
    requestedProfile: unknown,
    options: BackgroundShellOptions = {}
): BackgroundShellExecutionPlan {
    const requested = typeof requestedProfile === 'string' ? requestedProfile.trim() : '';
    if (!requested) {
        const execution = resolveShellExecutionPlan(command, {
            platform: options.platform,
            env: options.env,
            configuredPath: options.configuredCommandShellPath
        });
        return {
            file: execution.file,
            args: execution.args,
            profile: {
                id: execution.shell.id,
                path: execution.shell.path,
                shellKind: 'posix'
            }
        };
    }

    const profile = resolveTerminalProfile(requested, {
        platform: options.platform,
        env: options.env,
        configuredCommandShellPath: options.configuredCommandShellPath
    });
    const shellPath = profile.shellPath ?? profile.resolvedPath;
    if (!shellPath) {
        throw new Error(`Terminal profile '${profile.id}' does not expose a shell path for background execution.`);
    }

    return {
        file: shellPath,
        args: backgroundShellArgs(profile, shellPath, command),
        profile: {
            id: profile.id,
            path: shellPath,
            shellKind: profile.shellKind
        }
    };
}

export function describeBackgroundShellProfiles(options: BackgroundShellOptions = {}): string {
    const profiles = listTerminalProfiles({
        platform: options.platform,
        env: options.env,
        configuredCommandShellPath: options.configuredCommandShellPath
    }).filter(profile => profile.shellPath ?? profile.resolvedPath);

    return describeTerminalProfiles(profiles);
}

function backgroundShellArgs(
    profile: WebcodeTerminalProfile,
    shellPath: string,
    command: string
): string[] {
    if (profile.shellKind === 'powershell') {
        return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
    }

    const baseName = path.basename(shellPath).toLowerCase();
    return baseName === 'bash' || baseName === 'bash.exe' || baseName === 'zsh'
        ? ['-lc', command]
        : ['-c', command];
}
