import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const INSTALL_LOCK_DIR_NAME = '.install-lock';
const INSTALL_LOCK_OWNER_FILE = 'owner.json';
const INSTALL_LOCK_CANDIDATE_PREFIX = '.install-lock-candidate-';
const INSTALL_LOCK_RECLAIMED_PREFIX = '.install-lock-reclaimed-';
const INSTALL_LOCK_RECLAIM_GUARD_FILE = '.reclaim-guard';
const STALE_LOCK_MS = 2 * 60_000;
const LOCK_RETRY_MS = 50;

interface InstallLockSnapshot {
    identity: string;
    isStale: boolean;
}

export async function withBrowserExtensionFileLock<T>(
    rootDir: string,
    timeoutMs: number,
    callback: () => Promise<T>
): Promise<T> {
    const release = await acquireInstallLock(rootDir, timeoutMs);
    try {
        return await callback();
    } finally {
        await release();
    }
}

async function acquireInstallLock(
    rootDir: string,
    timeoutMs: number
): Promise<() => Promise<void>> {
    await fs.mkdir(rootDir, { recursive: true });
    const lockPath = path.join(rootDir, INSTALL_LOCK_DIR_NAME);
    const ownerPath = path.join(lockPath, INSTALL_LOCK_OWNER_FILE);
    const token = crypto.randomUUID();
    const candidatePath = path.join(rootDir, `${INSTALL_LOCK_CANDIDATE_PREFIX}${token}`);
    const deadline = Date.now() + timeoutMs;
    let acquired = false;

    await fs.mkdir(candidatePath);
    await fs.writeFile(path.join(candidatePath, INSTALL_LOCK_OWNER_FILE), JSON.stringify({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString()
    }), 'utf8');

    try {
        while (true) {
            try {
                await fs.rename(candidatePath, lockPath);
                acquired = true;
                return async () => {
                    const owner = await readLockOwner(ownerPath);
                    if (owner?.token === token) {
                        await fs.rm(lockPath, { recursive: true, force: true });
                    }
                };
            } catch (error: unknown) {
                if (!await pathExists(lockPath)) {
                    throw error;
                }
            }

            if (await reclaimStaleInstallLock(rootDir, lockPath)) {
                continue;
            }
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for browser bridge installation lock at ${lockPath}.`);
            }
            await delay(LOCK_RETRY_MS);
        }
    } finally {
        if (!acquired) {
            await fs.rm(candidatePath, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

async function reclaimStaleInstallLock(rootDir: string, lockPath: string): Promise<boolean> {
    const snapshot = await readInstallLockSnapshot(lockPath);
    if (!snapshot?.isStale) {
        return false;
    }

    // Ensure even a half-created empty lock becomes a non-empty tombstone. POSIX rename
    // may replace an empty directory, but cannot replace this guarded destination.
    try {
        await fs.writeFile(
            path.join(lockPath, INSTALL_LOCK_RECLAIM_GUARD_FILE),
            snapshot.identity,
            { flag: 'a' }
        );
    } catch (error: unknown) {
        if (hasErrorCode(error, 'ENOENT')) {
            return false;
        }
        throw error;
    }

    // Concurrent reclaimers target the same generation-specific destination. Once one
    // rename succeeds, a delayed reclaimer cannot move a subsequently acquired lock.
    const reclaimedPath = path.join(rootDir, `${INSTALL_LOCK_RECLAIMED_PREFIX}${snapshot.identity}`);
    try {
        await fs.rename(lockPath, reclaimedPath);
        return true;
    } catch (error: unknown) {
        if (await pathExists(reclaimedPath) || !await pathExists(lockPath)) {
            return false;
        }
        throw error;
    }
}

async function readInstallLockSnapshot(lockPath: string): Promise<InstallLockSnapshot | null> {
    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
        stats = await fs.stat(lockPath);
    } catch (error: unknown) {
        if (hasErrorCode(error, 'ENOENT')) {
            return null;
        }
        throw error;
    }

    const owner = await readLockOwner(path.join(lockPath, INSTALL_LOCK_OWNER_FILE));
    const identitySource = owner?.token ?? [
        stats.dev,
        stats.ino,
        stats.birthtimeMs,
        stats.mtimeMs
    ].join(':');
    return {
        identity: crypto.createHash('sha256').update(identitySource).digest('hex').slice(0, 32),
        isStale: owner ? !isProcessAlive(owner.pid) : Date.now() - stats.mtimeMs > STALE_LOCK_MS
    };
}

async function readLockOwner(ownerPath: string): Promise<{ pid: number; token: string } | null> {
    try {
        const value: unknown = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
        return isRecord(value) &&
            typeof value.pid === 'number' &&
            Number.isInteger(value.pid) &&
            value.pid > 0 &&
            typeof value.token === 'string'
            ? { pid: value.pid, token: value.token }
            : null;
    } catch {
        return null;
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        return hasErrorCode(error, 'EPERM');
    }
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

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
