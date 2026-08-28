import * as crypto from 'crypto';

import type { ToolRiskPreflight } from '../tools/types';
import { normalizeShellCommand } from './commandShell';
import { assessTerminalCommandRisk } from './terminalCommandRisk';
import type { TerminalShellKind } from './terminalProfiles';
import type { CommandRiskContext } from './commandRisk';

export function assessCommandToolRisk(options: {
    command: unknown;
    commandPath: string;
    profileId: string;
    shellKind: TerminalShellKind;
    toolName: 'execute_command' | 'run_in_terminal';
    riskContext: CommandRiskContext;
}): ToolRiskPreflight {
    const commandLine = normalizeShellCommand(options.command);
    const assessment = assessTerminalCommandRisk(commandLine, options.shellKind, options.riskContext);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        command: commandLine,
        path: options.commandPath,
        profile: options.profileId,
        tool: options.toolName
    })).digest('hex');

    return { assessment, fingerprint };
}
