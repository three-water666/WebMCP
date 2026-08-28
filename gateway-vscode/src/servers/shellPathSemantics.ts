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
    const normalizedPath = pathModule.resolve(pathModule.normalize(filePath));
    const normalizedDirectory = pathModule.resolve(pathModule.normalize(directory));
    return normalizedPath === normalizedDirectory
        || normalizedPath.startsWith(
            normalizedDirectory.endsWith(pathModule.sep)
                ? normalizedDirectory
                : `${normalizedDirectory}${pathModule.sep}`
        );
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
