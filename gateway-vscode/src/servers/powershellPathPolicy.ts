export function isNonFileSystemPowerShellProvider(candidate: string): boolean {
    if (/^[A-Za-z]:[\\/]/.test(candidate)) {
        return false;
    }

    return /^(?:[A-Za-z][A-Za-z0-9_-]*::|HK(?:CU|LM|CR|U|CC):|Cert:|Env:|Variable:|Function:|Alias:|WSMan:)/i
        .test(candidate);
}

export const isShellControlOption = (candidate: string): boolean =>
    ['/c', '/k', '/s', '/enc', '/encodedcommand'].includes(candidate.toLowerCase());
