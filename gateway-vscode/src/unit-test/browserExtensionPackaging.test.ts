import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { isAllowedBridgeRedemptionOrigin } from '../gateway/bridgeRoute';

const repoRoot = path.resolve(__dirname, '../../..');
const manifestPath = path.join(repoRoot, 'bridge-browser', 'manifest.json');
const copyScriptPath = path.join(repoRoot, 'gateway-vscode', 'scripts', 'copy-browser-extension.mjs');

interface PackagingFixture {
    sourceDir: string;
    targetDir: string;
    scriptPath: string;
}

suite('Browser extension packaging', () => {
    test('pins unpacked builds to the Chrome Web Store identity accepted by the gateway', async () => {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { key?: string };
        assert.ok(manifest.key, 'The browser source manifest must include the public identity key.');
        const extensionId = createHash('sha256')
            .update(Buffer.from(manifest.key, 'base64'))
            .digest('hex')
            .slice(0, 32)
            .replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));

        assert.strictEqual(extensionId, 'kghhldphcmpiimophipabdhldfipgiio');
        assert.strictEqual(isAllowedBridgeRedemptionOrigin(`chrome-extension://${extensionId}`), true);
    });

    test('preserves the standalone browser manifest when copying it into the VSIX', async () => {
        await withPackagingFixture(async ({ sourceDir, targetDir, scriptPath }) => {
            const originalManifest = await fs.readFile(path.join(sourceDir, 'manifest.json'), 'utf8');
            const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 10_000 });

            assert.ifError(result.error);
            assert.strictEqual(result.status, 0, result.stderr);
            assert.strictEqual(await fs.readFile(path.join(targetDir, 'manifest.json'), 'utf8'), originalManifest);
        });
    });

    for (const key of [undefined, 'unexpected-public-key']) {
        test(`rejects a prebuilt manifest with ${key ? 'a different key' : 'no key'} before replacing the bundle`, async () => {
            await withPackagingFixture(async ({ sourceDir, targetDir, scriptPath }) => {
                const builtManifestPath = path.join(sourceDir, 'manifest.json');
                const manifest = JSON.parse(await fs.readFile(builtManifestPath, 'utf8')) as Record<string, unknown>;
                await fs.writeFile(builtManifestPath, JSON.stringify({ ...manifest, key }));
                await fs.mkdir(targetDir);
                const existingFilePath = path.join(targetDir, 'existing.txt');
                await fs.writeFile(existingFilePath, 'existing bundle');

                const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 10_000 });

                assert.ifError(result.error);
                assert.notStrictEqual(result.status, 0);
                assert.match(result.stderr, /unexpected identity key/);
                assert.strictEqual(await fs.readFile(existingFilePath, 'utf8'), 'existing bundle');
            });
        });
    }
});

async function withPackagingFixture(run: (fixture: PackagingFixture) => Promise<void>): Promise<void> {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-browser-packaging-'));
    const sourceDir = path.join(fixtureRoot, 'bridge-browser', 'dist');
    const targetDir = path.join(fixtureRoot, 'gateway-vscode', 'browser-extension');
    const scriptPath = path.join(fixtureRoot, 'gateway-vscode', 'scripts', 'copy-browser-extension.mjs');
    const protocolPath = path.join(fixtureRoot, 'shared', 'src', 'bridgeProtocol.json');

    try {
        await Promise.all([
            fs.mkdir(sourceDir, { recursive: true }),
            fs.mkdir(path.dirname(scriptPath), { recursive: true }),
            fs.mkdir(path.dirname(protocolPath), { recursive: true })
        ]);
        await Promise.all([
            fs.copyFile(manifestPath, path.join(sourceDir, 'manifest.json')),
            fs.copyFile(manifestPath, path.join(fixtureRoot, 'bridge-browser', 'manifest.json')),
            fs.copyFile(copyScriptPath, scriptPath),
            fs.copyFile(path.join(repoRoot, 'shared', 'src', 'bridgeProtocol.json'), protocolPath)
        ]);
        await run({ sourceDir, targetDir, scriptPath });
    } finally {
        await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
}
