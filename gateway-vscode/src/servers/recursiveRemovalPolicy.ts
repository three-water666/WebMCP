import type { CommandRiskIssue } from './commandRiskTypes';

export function assessRecursiveRemoveTargets(
    targets: string[],
    isAllowedTarget: (target: string) => boolean
): CommandRiskIssue[] {
    if (targets.length === 0) {
        return [];
    }

    return [
        {
            level: 'requires_confirmation',
            reason: 'Recursive removal requires explicit approval.'
        },
        ...targets
            .filter(target => isDangerousRemovalTarget(target) || !isAllowedTarget(target))
            .map(() => ({
                level: 'blocked' as const,
                reason: 'Recursive removal of workspace root, outside paths, .git, or broad wildcards is not allowed.'
            }))
    ];
}

function isDangerousRemovalTarget(target: string): boolean {
    const lower = target.toLowerCase();
    const exactTargets = new Set(['/', '~', '.', '..', '*', './*', '/*', '~/*', '.git', '$pwd', '$home']);
    return exactTargets.has(lower)
        || lower.startsWith('../')
        || lower.startsWith('..\\')
        || lower.includes('/.git')
        || lower.includes('\\.git')
        || /^[a-z]:[\\/]*$/i.test(target);
}
