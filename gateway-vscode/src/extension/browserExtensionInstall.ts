import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { withBrowserExtensionFileLock } from './browserExtensionLock';

export interface BrowserExtensionBuild {
    schemaVersion: 1;
    extensionVersion: string;
    bridgeProtocolVersion: number;
    buildHash: string;
    builtAt: string;
}

export type PrepareBrowserExtensionResult =
    | { status: 'ready'; extensionPath: string; build: BrowserExtensionBuild }
    | { status: 'staged'; extensionPath: string; stagingPath: string; build: BrowserExtensionBuild }
    | { status: 'newer-installed'; installedBuild: BrowserExtensionBuild };

export interface BrowserExtensionInstallOptions {
    sourceDir: string;
    rootDir: string;
    lockTimeoutMs?: number;
}

export interface BrowserExtensionInstallLockOptions {
    rootDir: string;
    lockTimeoutMs?: number;
}

export interface BrowserExtensionInstallLease {
    readonly rootDir: string;
    prepare(sourceDir: string): Promise<PrepareBrowserExtensionResult>;
    activate(expectedBuild: BrowserExtensionBuild): Promise<PrepareBrowserExtensionResult>;
}

export const BROWSER_EXTENSION_BUILD_FILE = 'bridge-build.json';
export const BROWSER_EXTENSION_ACTIVE_DIR_NAME = 'bridge';

const PRODUCT_DATA_DIR_NAME = 'webcode';
const BROWSER_EXTENSION_ROOT_DIR_NAME = 'browser-extensions';
const INSTALL_RECORD_FILE = 'install.json';
const PREVIOUS_DIR_NAME = 'previous';
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;

export function resolveDefaultBrowserExtensionRoot(
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv = process.env,
    homeDir: string = os.homedir()
): string {
    const platformPath = platform === 'win32' ? path.win32 : path.posix;
    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA && platformPath.isAbsolute(env.LOCALAPPDATA)
            ? env.LOCALAPPDATA
            : platformPath.join(homeDir, 'AppData', 'Local');
        return platformPath.join(localAppData, PRODUCT_DATA_DIR_NAME, BROWSER_EXTENSION_ROOT_DIR_NAME);
    }

    if (platform === 'darwin') {
        return platformPath.join(
            homeDir,
            'Library',
            'Application Support',
            PRODUCT_DATA_DIR_NAME,
            BROWSER_EXTENSION_ROOT_DIR_NAME
        );
    }

    const dataHome = env.XDG_DATA_HOME && platformPath.isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : platformPath.join(homeDir, '.local', 'share');
    return platformPath.join(dataHome, PRODUCT_DATA_DIR_NAME, BROWSER_EXTENSION_ROOT_DIR_NAME);
}

export async function prepareBrowserExtensionInstall(
    options: BrowserExtensionInstallOptions
): Promise<PrepareBrowserExtensionResult> {
    return withBrowserExtensionInstallLock(options, lease => lease.prepare(options.sourceDir));
}

export async function activatePreparedBrowserExtension(
    options: Pick<BrowserExtensionInstallOptions, 'rootDir' | 'lockTimeoutMs'>,
    expectedBuild: BrowserExtensionBuild
): Promise<PrepareBrowserExtensionResult> {
    return withBrowserExtensionInstallLock(options, lease => lease.activate(expectedBuild));
}

export async function withBrowserExtensionInstallLock<T>(
    options: BrowserExtensionInstallLockOptions,
    callback: (lease: BrowserExtensionInstallLease) => Promise<T>
): Promise<T> {
    const rootDir = path.resolve(options.rootDir);
    const lease: BrowserExtensionInstallLease = {
        rootDir,
        prepare: sourceDir => prepareBrowserExtensionInstallUnderLock(path.resolve(sourceDir), rootDir),
        activate: expectedBuild => activatePreparedBrowserExtensionUnderLock(rootDir, expectedBuild)
    };
    return withBrowserExtensionFileLock(
        rootDir,
        options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
        () => callback(lease)
    );
}

async function prepareBrowserExtensionInstallUnderLock(
    sourceDir: string,
    rootDir: string
): Promise<PrepareBrowserExtensionResult> {
    const sourceBuild = await readAndValidateBrowserExtensionBuild(sourceDir);
    const activePath = path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME);
    const activeBuild = await tryReadBrowserExtensionBuild(activePath);
    if (activeBuild?.buildHash === sourceBuild.buildHash) {
        await writeInstallRecord(rootDir, sourceBuild).catch(() => undefined);
        return { status: 'ready', extensionPath: activePath, build: sourceBuild };
    }
    if (activeBuild && compareBrowserExtensionBuilds(activeBuild, sourceBuild) > 0) {
        return { status: 'newer-installed', installedBuild: activeBuild };
    }

    const stagingPath = getStagingPath(rootDir, sourceBuild);
    const stagedBuild = await tryReadBrowserExtensionBuild(stagingPath);
    if (stagedBuild?.buildHash !== sourceBuild.buildHash) {
        await fs.rm(stagingPath, { recursive: true, force: true });
        await fs.cp(sourceDir, stagingPath, {
            recursive: true,
            errorOnExist: true,
            force: false
        });
        const copiedBuild = await readAndValidateBrowserExtensionBuild(stagingPath);
        if (copiedBuild.buildHash !== sourceBuild.buildHash) {
            throw new Error('The copied browser bridge build does not match its source build.');
        }
    }

    const newerStagedBuild = await cleanOtherStagingDirectories(rootDir, stagingPath, sourceBuild);
    if (newerStagedBuild) {
        return { status: 'newer-installed', installedBuild: newerStagedBuild };
    }

    return { status: 'staged', extensionPath: activePath, stagingPath, build: sourceBuild };
}

async function activatePreparedBrowserExtensionUnderLock(
    rootDir: string,
    expectedBuild: BrowserExtensionBuild
): Promise<PrepareBrowserExtensionResult> {
    const activePath = path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME);
    const activeBuild = await tryReadBrowserExtensionBuild(activePath);
    if (activeBuild?.buildHash === expectedBuild.buildHash) {
        await writeInstallRecord(rootDir, expectedBuild).catch(() => undefined);
        return { status: 'ready', extensionPath: activePath, build: expectedBuild };
    }
    if (activeBuild && compareBrowserExtensionBuilds(activeBuild, expectedBuild) > 0) {
        return { status: 'newer-installed', installedBuild: activeBuild };
    }

    const stagingPath = getStagingPath(rootDir, expectedBuild);
    const stagedBuild = await readAndValidateBrowserExtensionBuild(stagingPath);
    if (stagedBuild.buildHash !== expectedBuild.buildHash) {
        throw new Error('The prepared browser bridge build changed before activation.');
    }

    const previousPath = path.join(rootDir, PREVIOUS_DIR_NAME);
    await fs.rm(previousPath, { recursive: true, force: true });
    const hadActiveDirectory = await pathExists(activePath);
    if (hadActiveDirectory) {
        await fs.rename(activePath, previousPath);
    }

    try {
        await fs.rename(stagingPath, activePath);
        const installedBuild = await readAndValidateBrowserExtensionBuild(activePath);
        if (installedBuild.buildHash !== expectedBuild.buildHash) {
            throw new Error('The activated browser bridge build failed validation.');
        }
    } catch (error: unknown) {
        await fs.rm(activePath, { recursive: true, force: true }).catch(() => undefined);
        if (hadActiveDirectory && await pathExists(previousPath)) {
            await fs.rename(previousPath, activePath).catch(() => undefined);
        }
        throw error;
    }

    await writeInstallRecord(rootDir, expectedBuild).catch(() => undefined);
    return { status: 'ready', extensionPath: activePath, build: expectedBuild };
}

export async function readAndValidateBrowserExtensionBuild(
    extensionDir: string
): Promise<BrowserExtensionBuild> {
    const descriptorPath = path.join(extensionDir, BROWSER_EXTENSION_BUILD_FILE);
    const parsed: unknown = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
    const build = parseBrowserExtensionBuild(parsed);
    if (!build) {
        throw new Error(`Invalid browser bridge build descriptor: ${descriptorPath}`);
    }

    const manifestPath = path.join(extensionDir, 'manifest.json');
    const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (!isRecord(manifest) || manifest.version !== build.extensionVersion) {
        throw new Error(`Browser bridge manifest version does not match ${BROWSER_EXTENSION_BUILD_FILE}.`);
    }

    const actualHash = await calculateBrowserExtensionBuildHash(extensionDir);
    if (actualHash !== build.buildHash) {
        throw new Error(`Browser bridge files do not match ${BROWSER_EXTENSION_BUILD_FILE}.`);
    }
    return build;
}

export async function calculateBrowserExtensionBuildHash(extensionDir: string): Promise<string> {
    const files = await collectExtensionFiles(extensionDir);
    const hash = crypto.createHash('sha256');
    for (const filePath of files) {
        const relativePath = path.relative(extensionDir, filePath).replace(/\\/g, '/');
        if (relativePath === BROWSER_EXTENSION_BUILD_FILE) {
            continue;
        }
        hash.update(relativePath, 'utf8');
        hash.update('\0');
        hash.update(await fs.readFile(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

export function compareBrowserExtensionBuilds(
    left: BrowserExtensionBuild,
    right: BrowserExtensionBuild
): number {
    const versionComparison = compareVersions(left.extensionVersion, right.extensionVersion);
    if (versionComparison !== 0) {
        return versionComparison;
    }

    return Date.parse(left.builtAt) - Date.parse(right.builtAt);
}

async function tryReadBrowserExtensionBuild(extensionDir: string): Promise<BrowserExtensionBuild | null> {
    try {
        return await readAndValidateBrowserExtensionBuild(extensionDir);
    } catch {
        return null;
    }
}

async function collectExtensionFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Browser bridge build contains a symbolic link: ${entryPath}`);
        }
        if (entry.isDirectory()) {
            files.push(...await collectExtensionFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}

async function cleanOtherStagingDirectories(
    rootDir: string,
    currentStagingPath: string,
    sourceBuild: BrowserExtensionBuild
): Promise<BrowserExtensionBuild | null> {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('staging-')) {
            continue;
        }
        const candidatePath = path.join(rootDir, entry.name);
        if (path.resolve(candidatePath) === path.resolve(currentStagingPath)) {
            continue;
        }
        const candidateBuild = await tryReadBrowserExtensionBuild(candidatePath);
        if (candidateBuild && compareBrowserExtensionBuilds(candidateBuild, sourceBuild) > 0) {
            return candidateBuild;
        }
        await fs.rm(candidatePath, { recursive: true, force: true });
    }
    return null;
}

function getStagingPath(rootDir: string, build: BrowserExtensionBuild): string {
    return path.join(rootDir, `staging-${build.buildHash.slice(0, 16)}`);
}

function parseBrowserExtensionBuild(value: unknown): BrowserExtensionBuild | null {
    if (!isRecord(value) ||
        value.schemaVersion !== 1 ||
        typeof value.extensionVersion !== 'string' ||
        !value.extensionVersion ||
        typeof value.bridgeProtocolVersion !== 'number' ||
        !Number.isInteger(value.bridgeProtocolVersion) ||
        value.bridgeProtocolVersion <= 0 ||
        typeof value.buildHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.buildHash) ||
        typeof value.builtAt !== 'string' ||
        !Number.isFinite(Date.parse(value.builtAt))) {
        return null;
    }
    return value as unknown as BrowserExtensionBuild;
}

function compareVersions(left: string, right: string): number {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) {
        return left.localeCompare(right, undefined, { numeric: true });
    }
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

function parseVersion(version: string): number[] | null {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:\.([0-9]+))?$/.exec(version);
    return match ? match.slice(1).filter(Boolean).map(Number) : null;
}

async function writeInstallRecord(rootDir: string, build: BrowserExtensionBuild): Promise<void> {
    const targetPath = path.join(rootDir, INSTALL_RECORD_FILE);
    const temporaryPath = path.join(rootDir, `${INSTALL_RECORD_FILE}.tmp-${process.pid}-${crypto.randomUUID()}`);
    await fs.writeFile(temporaryPath, `${JSON.stringify({
        ...build,
        activeDirectory: BROWSER_EXTENSION_ACTIVE_DIR_NAME
    }, null, 2)}\n`, 'utf8');
    await fs.rm(targetPath, { force: true });
    await fs.rename(temporaryPath, targetPath);
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch (error: unknown) {
        if (hasErrorCode(error, 'ENOENT')) {
            return false;
        }
        throw error;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
