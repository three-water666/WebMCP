import * as assert from 'assert';
import { AsyncLocalStorage } from 'async_hooks';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mock } from 'node:test';

import { withBrowserExtensionFileLock } from '../extension/browserExtensionLock';

suite('Browser extension lock reclamation', () => {
    test('does not combine an old directory stat with a missing owner to reclaim a new live lock', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-lock-race-'));
        const lockPath = path.join(rootDir, '.install-lock');
        const finish = createSignal();
        const contenders: Promise<void>[] = [];
        let activeCallbacks = 0;
        let maximumActiveCallbacks = 0;
        let race: ReturnType<typeof controlSnapshotRace> | undefined;

        try {
            await fs.mkdir(lockPath);
            await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({
                pid: 2_147_483_647,
                token: 'abandoned-owner'
            }));
            const staleTime = new Date(Date.now() - 3 * 60_000);
            await fs.utimes(lockPath, staleTime, staleTime);
            const controlledRace = controlSnapshotRace(lockPath);
            race = controlledRace;

            const holdLock = async () => {
                activeCallbacks += 1;
                maximumActiveCallbacks = Math.max(maximumActiveCallbacks, activeCallbacks);
                if (controlledRace.actor.getStore() === 'winner') {
                    controlledRace.winnerEntered.resolve();
                } else {
                    controlledRace.delayedObserved.resolve();
                }
                await finish.promise;
                activeCallbacks -= 1;
            };
            const contend = (actor: 'delayed' | 'winner') => controlledRace.actor.run(actor, () =>
                withBrowserExtensionFileLock(rootDir, 3_000, holdLock)
            );

            contenders.push(contend('delayed'));
            await waitForSignal(controlledRace.statCaptured.promise);
            contenders.push(contend('winner'));
            await waitForSignal(controlledRace.delayedObserved.promise);
            assert.strictEqual(maximumActiveCallbacks, 1, 'A delayed reclaimer must not enter while the winner owns the lock.');
        } finally {
            finish.resolve();
            race?.releaseSignals();
            const results = await Promise.allSettled(contenders);
            race?.restore();
            await fs.rm(rootDir, { recursive: true, force: true });
            for (const result of results) {
                if (result.status === 'rejected') {
                    throw result.reason;
                }
            }
        }
    }).timeout(10_000);
});

function controlSnapshotRace(lockPath: string) {
    const actor = new AsyncLocalStorage<'delayed' | 'winner'>();
    const statCaptured = createSignal();
    const oldDirectoryMoved = createSignal();
    const ownerMissing = createSignal();
    const winnerEntered = createSignal();
    const delayedObserved = createSignal();
    const original = { stat: fs.stat, readFile: fs.readFile, rename: fs.rename, mkdir: fs.mkdir };
    let captured = false;
    let observedMissingOwner = false;

    const statMock = mock.method(fs, 'stat', async (...args: Parameters<typeof fs.stat>) => {
        const stats = await original.stat(...args);
        if (args[0] === lockPath && actor.getStore() === 'delayed' && !captured) {
            captured = true;
            statCaptured.resolve();
            await oldDirectoryMoved.promise;
        }
        return stats;
    });
    const readMock = mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
        try {
            return await original.readFile(...args);
        } catch (error: unknown) {
            if (args[0] === path.join(lockPath, 'owner.json') && actor.getStore() === 'delayed') {
                assert.ok(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT');
                observedMissingOwner = true;
                ownerMissing.resolve();
                await winnerEntered.promise;
            }
            throw error;
        }
    });
    const renameMock = mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
        await original.rename(...args);
        if (args[0] === lockPath && actor.getStore() === 'winner') {
            oldDirectoryMoved.resolve();
            await ownerMissing.promise;
        }
    });
    const mkdirMock = mock.method(fs, 'mkdir', async (...args: Parameters<typeof fs.mkdir>) => {
        try {
            return await original.mkdir(...args);
        } catch (error: unknown) {
            // A correct reclaimer retries mkdir while the winner is still in its callback.
            // The buggy implementation instead moves that live directory and enters too.
            if (args[0] === lockPath && actor.getStore() === 'delayed' && observedMissingOwner) {
                delayedObserved.resolve();
            }
            throw error;
        }
    });

    return {
        actor, statCaptured, winnerEntered, delayedObserved,
        releaseSignals() {
            statCaptured.resolve();
            oldDirectoryMoved.resolve();
            ownerMissing.resolve();
            winnerEntered.resolve();
            delayedObserved.resolve();
        },
        restore() {
            statMock.mock.restore();
            readMock.mock.restore();
            renameMock.mock.restore();
            mkdirMock.mock.restore();
        }
    };
}

function createSignal(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(fulfill => { resolve = fulfill; });
    return { promise, resolve };
}

async function waitForSignal(signal: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            signal,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Timed out controlling the lock reclamation race.')), 3_000);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}
