import * as path from 'path';

import type { TerminalShellKind } from './terminalProfiles';

export function getPathModule(platform: NodeJS.Platform | undefined): path.PlatformPath {
    return (platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
}

export function isInsideDirectory(
    filePath: string,
    directory: string,
    pathModule: path.PlatformPath
): boolean {
    const normalizedPath = normalizeForComparison(filePath, pathModule);
    const normalizedDirectory = normalizeForComparison(directory, pathModule);
    return normalizedPath === normalizedDirectory
        || normalizedPath.startsWith(
            normalizedDirectory.endsWith(pathModule.sep)
                ? normalizedDirectory
                : `${normalizedDirectory}${pathModule.sep}`
        );
}

function normalizeForComparison(value: string, pathModule: path.PlatformPath): string {
    const normalized = pathModule.resolve(pathModule.normalize(value));
    return pathModule === path.win32 ? normalized.toLowerCase() : normalized;
}

export function isUnverifiableMsysAbsolutePath(
    candidate: string,
    shellKind: TerminalShellKind,
    platform: NodeJS.Platform | undefined
): boolean {
    return shellKind === 'posix'
        && (platform ?? process.platform) === 'win32'
        && candidate.startsWith('/');
}
