export function matchesPowerShellSwitch(arg: string, fullName: string): boolean {
    const switchName = normalizePowerShellSwitch(arg);
    return switchName.length > 0 && fullName.startsWith(switchName);
}

function normalizePowerShellSwitch(arg: string): string {
    const lower = arg.toLowerCase();
    if (lower.startsWith('/')) {
        return lower.slice(1).split(':', 1)[0];
    }
    if (lower.startsWith('-')) {
        return lower.replace(/^-+/, '').split(':', 1)[0];
    }

    return '';
}
