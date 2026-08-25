import {
    assessParsedShellCommandRisk,
    CommandRiskError,
    type CommandRiskAssessment,
    type CommandRiskContext
} from './commandRisk';
import { parseShellCommand } from './shellCommandParser';
import type { TerminalShellKind } from './terminalProfiles';

export function assessTerminalCommandRisk(
    command: string,
    shellKind: TerminalShellKind,
    context: CommandRiskContext = {}
): CommandRiskAssessment {
    return assessParsedShellCommandRisk(parseShellCommand(command, shellKind), context);
}

export function assertTerminalCommandRiskAllowed(
    command: string,
    shellKind: TerminalShellKind,
    context: CommandRiskContext = {}
): void {
    const assessment = assessTerminalCommandRisk(command, shellKind, context);
    if (assessment.level === 'blocked') {
        throw new CommandRiskError(assessment);
    }
}
