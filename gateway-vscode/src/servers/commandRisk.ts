import { assessCommandPolicy } from './commandPolicy';
import { assessPathPolicy } from './commandPathPolicy';
import {
    combineRiskIssues,
    type CommandRiskAssessment,
    type CommandRiskContext
} from './commandRiskTypes';
import { parseShellCommand, type ParsedShellCommand } from './shellCommandParser';
import { collectLiteralNestedShellCommands } from './nestedShellCommand';

export type { CommandRiskAssessment, CommandRiskContext, CommandRiskLevel } from './commandRiskTypes';

export class CommandRiskError extends Error {
    constructor(readonly assessment: CommandRiskAssessment) {
        super(formatCommandRiskAssessment(assessment));
        this.name = 'CommandRiskError';
    }
}

export function assessShellCommandRisk(command: string, context: CommandRiskContext = {}): CommandRiskAssessment {
    // execute_command always targets POSIX/Git Bash syntax regardless of host platform.
    return assessParsedShellCommandRisk(parseShellCommand(command, 'posix'), context);
}

export function assessParsedShellCommandRisk(
    parsed: ParsedShellCommand,
    context: CommandRiskContext = {}
): CommandRiskAssessment {
    return assessParsedShellCommandRiskAtDepth(parsed, context, 0);
}

function assessParsedShellCommandRiskAtDepth(
    parsed: ParsedShellCommand,
    context: CommandRiskContext,
    depth: number
): CommandRiskAssessment {
    const directIssues = [
        ...assessCommandPolicy(parsed),
        ...assessPathPolicy(parsed, context)
    ];
    if (depth >= 3) {
        return combineRiskIssues(directIssues);
    }

    const nestedIssues = collectLiteralNestedShellCommands(parsed).flatMap(nested => {
        const assessment = assessParsedShellCommandRiskAtDepth(
            parseShellCommand(nested.command, nested.shellKind),
            context,
            depth + 1
        );
        if (assessment.level === 'allowed') {
            return [];
        }

        const level = assessment.level;
        return assessment.reasons.map(reason => ({ level, reason }));
    });
    return combineRiskIssues([...directIssues, ...nestedIssues]);
}

export function assertShellCommandRiskAllowed(command: string, context: CommandRiskContext = {}): void {
    const assessment = assessShellCommandRisk(command, context);
    if (assessment.level === 'blocked') {
        throw new CommandRiskError(assessment);
    }
}

export function formatCommandRiskAssessment(assessment: CommandRiskAssessment): string {
    if (assessment.level === 'allowed') {
        return 'Command risk assessment passed.';
    }

    const action = assessment.level === 'blocked' ? 'rejected' : 'requires confirmation';
    return `Command ${action} by ${assessment.level} risk policy: ${assessment.reasons.join(' ')}`;
}
