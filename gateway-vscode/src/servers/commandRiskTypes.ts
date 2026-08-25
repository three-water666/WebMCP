export type CommandRiskLevel = 'allowed' | 'requires_confirmation' | 'blocked';

export interface CommandRiskAssessment {
    level: CommandRiskLevel;
    reasons: string[];
}

export interface CommandRiskContext {
    workspaceRoot?: string;
    cwd?: string;
    allowedRoots?: string[];
    platform?: NodeJS.Platform;
}

export interface CommandRiskIssue {
    level: Exclude<CommandRiskLevel, 'allowed'>;
    reason: string;
}

export function combineRiskIssues(issues: CommandRiskIssue[]): CommandRiskAssessment {
    const blocked = issues.filter(issue => issue.level === 'blocked').map(issue => issue.reason);
    const confirmation = issues
        .filter(issue => issue.level === 'requires_confirmation')
        .map(issue => issue.reason);
    const reasons = unique(blocked.length > 0 ? blocked : confirmation);

    return {
        level: blocked.length > 0
            ? 'blocked'
            : confirmation.length > 0
                ? 'requires_confirmation'
                : 'allowed',
        reasons
    };
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values));
}
