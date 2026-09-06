import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import {
    activatePreparedBrowserExtension,
    BROWSER_EXTENSION_ACTIVE_DIR_NAME,
    BROWSER_EXTENSION_BUILD_FILE,
    calculateBrowserExtensionBuildHash,
    prepareBrowserExtensionInstall,
    readAndValidateBrowserExtensionBuild,
    resolveBrowserExtensionRoot,
    resolveDefaultBrowserExtensionRoot,
    withBrowserExtensionInstallLock,
    type BrowserExtensionBuild
} from '../extension/browserExtensionInstall';

suite('Browser extension installation', () => {
    test('resolves a version-independent app data root', () => {
        assert.strictEqual(
            resolveDefaultBrowserExtensionRoot(
                'win32',
                { LOCALAPPDATA: path.win32.join('C:\\', 'Users', 'me', 'AppData', 'Local') },
                path.win32.join('C:\\', 'Users', 'me')
            ),
            path.win32.join('C:\\', 'Users', 'me', 'AppData', 'Local', 'webcode', 'browser-extensions')
        );
        assert.strictEqual(
            resolveDefaultBrowserExtensionRoot('darwin', {}, '/Users/me'),
            path.posix.join('/Users/me', 'Library', 'Application Support', 'webcode', 'browser-extensions')
        );
        assert.strictEqual(
            resolveDefaultBrowserExtensionRoot('linux', {}, '/home/me'),
            path.posix.join('/home/me', '.local', 'share', 'webcode', 'browser-extensions')
        );
    });

    test('keeps development installations in separate storage on every supported platform', () => {
        for (const platform of ['win32', 'darwin', 'linux'] as const) {
            const platformPath = platform === 'win32' ? path.win32 : path.posix;
            const homeDir = platform === 'win32' ? 'C:\\Users\\me' : '/home/me';
            const developmentStorageRoot = platformPath.join(homeDir, 'vscode-storage');
            const options = { platform, homeDir, env: {} };
            const productionRoot = resolveBrowserExtensionRoot(options);
            const developmentRoot = resolveBrowserExtensionRoot({ ...options, developmentStorageRoot });

            assert.strictEqual(productionRoot, resolveDefaultBrowserExtensionRoot(platform, {}, homeDir));
            assert.strictEqual(
                developmentRoot,
                platformPath.join(developmentStorageRoot, 'browser-extensions-development')
            );
            assert.notStrictEqual(developmentRoot, productionRoot);
        }
    });

    test('honors explicit install roots in production and development and rejects relative overrides', () => {
        const overrideRoot = path.resolve('custom-browser-extensions');
        for (const developmentStorageRoot of [undefined, path.resolve('development-storage')]) {
            assert.strictEqual(resolveBrowserExtensionRoot({
                developmentStorageRoot,
                env: { WEBCODE_BROWSER_EXTENSION_ROOT: `  ${overrideRoot}  ` }
            }), overrideRoot);
            assert.throws(() => resolveBrowserExtensionRoot({
                developmentStorageRoot,
                env: { WEBCODE_BROWSER_EXTENSION_ROOT: './relative-root' }
            }), /must be absolute/);
        }
    });

    test('a later development build at the same version cannot block the production installation', async () => {
        await withTempInstall(async ({ rootDir, sourceRoot }) => {
            const options = { env: {}, homeDir: rootDir };
            const productionRoot = resolveBrowserExtensionRoot(options);
            const developmentRoot = resolveBrowserExtensionRoot({
                ...options,
                developmentStorageRoot: path.join(rootDir, 'vscode-storage')
            });
            const production = await createExtensionBuild(sourceRoot, 'release', '1.0.1', '2026-09-01T00:00:00.000Z');
            const development = await createExtensionBuild(sourceRoot, 'development', '1.0.1', '2026-09-02T00:00:00.000Z');

            await prepareBrowserExtensionInstall({ sourceDir: production.path, rootDir: productionRoot });
            const stagedDevelopment = await prepareBrowserExtensionInstall({ sourceDir: development.path, rootDir: developmentRoot });
            assert.strictEqual(stagedDevelopment.status, 'staged');
            const stagedProduction = await prepareBrowserExtensionInstall({ sourceDir: production.path, rootDir: productionRoot });
            assert.strictEqual(stagedProduction.status, 'staged');

            const activatedDevelopment = await activatePreparedBrowserExtension({ rootDir: developmentRoot }, development.build);
            assert.strictEqual(activatedDevelopment.status, 'ready');
            const activatedProduction = await activatePreparedBrowserExtension({ rootDir: productionRoot }, production.build);
            assert.strictEqual(activatedProduction.status, 'ready');

            const reinstalled = await prepareBrowserExtensionInstall({ sourceDir: production.path, rootDir: productionRoot });
            assert.strictEqual(reinstalled.status, 'ready');
            assert.deepStrictEqual(
                await readAndValidateBrowserExtensionBuild(path.join(productionRoot, BROWSER_EXTENSION_ACTIVE_DIR_NAME)),
                production.build
            );
            assert.deepStrictEqual(
                await readAndValidateBrowserExtensionBuild(path.join(developmentRoot, BROWSER_EXTENSION_ACTIVE_DIR_NAME)),
                development.build
            );
        });
    });

    test('stages complete builds and switches the stable bridge path only after activation', async () => {
        await withTempInstall(async ({ rootDir, sourceRoot }) => {
            const sourceV1 = await createExtensionBuild(sourceRoot, 'v1', '1.0.1', '2026-09-01T00:00:00.000Z');
            const preparedV1 = await prepareBrowserExtensionInstall({ sourceDir: sourceV1.path, rootDir });

            assert.strictEqual(preparedV1.status, 'staged');
            assert.strictEqual(await pathExists(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME)), false);
            if (preparedV1.status !== 'staged') {
                return;
            }
            const activatedV1 = await activatePreparedBrowserExtension({ rootDir }, preparedV1.build);
            assert.strictEqual(activatedV1.status, 'ready');
            assert.strictEqual(
                await fs.readFile(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME, 'worker.js'), 'utf8'),
                'v1'
            );

            const sourceV2 = await createExtensionBuild(sourceRoot, 'v2', '1.0.2', '2026-09-02T00:00:00.000Z');
            const preparedV2 = await prepareBrowserExtensionInstall({ sourceDir: sourceV2.path, rootDir });

            assert.strictEqual(preparedV2.status, 'staged');
            assert.strictEqual(
                await fs.readFile(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME, 'worker.js'), 'utf8'),
                'v1'
            );
            if (preparedV2.status !== 'staged') {
                return;
            }
            const activatedV2 = await activatePreparedBrowserExtension({ rootDir }, preparedV2.build);
            assert.strictEqual(activatedV2.status, 'ready');
            assert.strictEqual(
                await fs.readFile(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME, 'worker.js'), 'utf8'),
                'v2'
            );
            assert.strictEqual(await fs.readFile(path.join(rootDir, 'previous', 'worker.js'), 'utf8'), 'v1');
        });
    });

    test('reuses an installed build and serializes concurrent preparation', async () => {
        await withTempInstall(async ({ rootDir, sourceRoot }) => {
            const source = await createExtensionBuild(sourceRoot, 'same', '1.0.1', '2026-09-01T00:00:00.000Z');
            const preparedResults = await Promise.all([
                prepareBrowserExtensionInstall({ sourceDir: source.path, rootDir }),
                prepareBrowserExtensionInstall({ sourceDir: source.path, rootDir })
            ]);
            const staged = preparedResults[0].status === 'staged' ? preparedResults[0] : preparedResults[1];
            assert.strictEqual(staged.status, 'staged');
            if (staged.status !== 'staged') {
                return;
            }

            await activatePreparedBrowserExtension({ rootDir }, staged.build);
            const reused = await prepareBrowserExtensionInstall({ sourceDir: source.path, rootDir });
            assert.strictEqual(reused.status, 'ready');
            assert.deepStrictEqual(
                await readAndValidateBrowserExtensionBuild(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME)),
                source.build
            );
        });
    });

    test('does not let an older VSIX overwrite a newer installed bridge', async () => {
        await withTempInstall(async ({ rootDir, sourceRoot }) => {
            const newer = await createExtensionBuild(sourceRoot, 'newer', '1.1.0', '2026-09-02T00:00:00.000Z');
            const prepared = await prepareBrowserExtensionInstall({ sourceDir: newer.path, rootDir });
            assert.strictEqual(prepared.status, 'staged');
            if (prepared.status !== 'staged') {
                return;
            }
            await activatePreparedBrowserExtension({ rootDir }, prepared.build);

            const older = await createExtensionBuild(sourceRoot, 'older', '1.0.9', '2026-09-03T00:00:00.000Z');
            const downgrade = await prepareBrowserExtensionInstall({ sourceDir: older.path, rootDir });

            assert.strictEqual(downgrade.status, 'newer-installed');
            assert.strictEqual(
                await fs.readFile(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME, 'worker.js'), 'utf8'),
                'newer'
            );
        });
    });

    test('rejects a build whose files changed after its descriptor was written', async () => {
        await withTempInstall(async ({ rootDir, sourceRoot }) => {
            const source = await createExtensionBuild(sourceRoot, 'original', '1.0.1', '2026-09-01T00:00:00.000Z');
            await fs.writeFile(path.join(source.path, 'worker.js'), 'tampered', 'utf8');

            await assert.rejects(
                prepareBrowserExtensionInstall({ sourceDir: source.path, rootDir }),
                /do not match/
            );
            assert.strictEqual(await pathExists(path.join(rootDir, BROWSER_EXTENSION_ACTIVE_DIR_NAME)), false);
        });
    });

    test('reclaims one stale lock generation without overlapping contenders', async () => {
        await withTempInstall(({ rootDir }) => verifyStaleLockReclamation(rootDir));
    });

    test('keeps stale empty lock reclamation atomic on POSIX rename semantics', async () => {
        await withTempInstall(({ rootDir }) => verifyEmptyStaleLockReclamation(rootDir));
    });

    test('keeps a launch-sized critical section serialized with bridge mutations', async () => {
        await withTempInstall(({ rootDir }) => verifyLaunchLockSerialization(rootDir));
    });
});

async function verifyStaleLockReclamation(rootDir: string): Promise<void> {
    const lockPath = path.join(rootDir, '.install-lock');
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({
        pid: 2_147_483_647,
        token: 'abandoned-owner'
    }), 'utf8');

    let activeCallbacks = 0;
    let maximumActiveCallbacks = 0;
    const contend = () => withBrowserExtensionInstallLock({ rootDir }, async () => {
        activeCallbacks += 1;
        maximumActiveCallbacks = Math.max(maximumActiveCallbacks, activeCallbacks);
        await delay(30);
        activeCallbacks -= 1;
    });

    await Promise.all([contend(), contend()]);

    assert.strictEqual(maximumActiveCallbacks, 1);
    const entries = await fs.readdir(rootDir);
    assert.strictEqual(entries.filter(entry => entry.startsWith('.install-lock-reclaimed-')).length, 1);
    assert.strictEqual(await pathExists(lockPath), false);
}

async function verifyLaunchLockSerialization(rootDir: string): Promise<void> {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>(resolve => {
        releaseFirst = resolve;
    });
    let reportFirstStarted!: () => void;
    const firstStarted = new Promise<void>(resolve => {
        reportFirstStarted = resolve;
    });

    const first = withBrowserExtensionInstallLock({ rootDir }, async () => {
        events.push('launch-start');
        reportFirstStarted();
        await firstMayFinish;
        events.push('launch-end');
    });
    await firstStarted;
    const second = withBrowserExtensionInstallLock({ rootDir }, () => {
        events.push('activation');
        return Promise.resolve();
    });

    await delay(30);
    assert.deepStrictEqual(events, ['launch-start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepStrictEqual(events, ['launch-start', 'launch-end', 'activation']);
}

async function verifyEmptyStaleLockReclamation(rootDir: string): Promise<void> {
    const lockPath = path.join(rootDir, '.install-lock');
    await fs.mkdir(lockPath, { recursive: true });
    const staleTime = new Date(Date.now() - 3 * 60_000);
    await fs.utimes(lockPath, staleTime, staleTime);

    await Promise.all([
        withBrowserExtensionInstallLock({ rootDir }, () => delay(30)),
        withBrowserExtensionInstallLock({ rootDir }, () => delay(30))
    ]);

    const entries = await fs.readdir(rootDir);
    const reclaimed = entries.filter(entry => entry.startsWith('.install-lock-reclaimed-'));
    assert.strictEqual(reclaimed.length, 1);
    assert.strictEqual(
        await fs.readFile(path.join(rootDir, reclaimed[0], '.reclaim-guard'), 'utf8') !== '',
        true
    );
    assert.strictEqual(await pathExists(lockPath), false);
}

async function withTempInstall(
    callback: (paths: { rootDir: string; sourceRoot: string }) => Promise<void>
): Promise<void> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-browser-extension-'));
    try {
        await callback({
            rootDir: path.join(tempRoot, 'installed'),
            sourceRoot: path.join(tempRoot, 'sources')
        });
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

async function createExtensionBuild(
    sourceRoot: string,
    workerContents: string,
    extensionVersion: string,
    builtAt: string
): Promise<{ path: string; build: BrowserExtensionBuild }> {
    const extensionPath = path.join(sourceRoot, `${extensionVersion}-${workerContents}`);
    await fs.mkdir(extensionPath, { recursive: true });
    await fs.writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({
        manifest_version: 3,
        name: 'Test bridge',
        version: extensionVersion
    }), 'utf8');
    await fs.writeFile(path.join(extensionPath, 'worker.js'), workerContents, 'utf8');

    const build: BrowserExtensionBuild = {
        schemaVersion: 1,
        extensionVersion,
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
        buildHash: await calculateBrowserExtensionBuildHash(extensionPath),
        builtAt
    };
    await fs.writeFile(
        path.join(extensionPath, BROWSER_EXTENSION_BUILD_FILE),
        `${JSON.stringify(build, null, 2)}\n`,
        'utf8'
    );
    return { path: extensionPath, build };
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
