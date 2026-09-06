import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD_DESCRIPTOR_FILE = 'bridge-build.json';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDir, '..');
const repoRoot = resolve(extensionRoot, '..');
const sourceDir = resolve(repoRoot, 'bridge-browser', 'dist');
const targetDir = resolve(extensionRoot, 'browser-extension');
const bridgeProtocolPath = resolve(repoRoot, 'shared', 'src', 'bridgeProtocol.json');

if (!existsSync(resolve(sourceDir, 'manifest.json'))) {
  throw new Error(`Browser extension build not found at ${sourceDir}`);
}

const sourceManifestPath = resolve(repoRoot, 'bridge-browser', 'manifest.json');
const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(sourceDir, 'manifest.json'), 'utf8'));
// ZIP and VSIX builds share the Chrome Web Store public identity from the source manifest.
if (typeof sourceManifest.key !== 'string' || !sourceManifest.key || manifest.key !== sourceManifest.key) {
  throw new Error('Browser extension build has an unexpected identity key. Rebuild bridge-browser before packaging.');
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

const bridgeProtocol = JSON.parse(readFileSync(bridgeProtocolPath, 'utf8'));
const buildDescriptor = {
  schemaVersion: 1,
  extensionVersion: manifest.version,
  bridgeProtocolVersion: bridgeProtocol.version,
  buildHash: hashExtensionFiles(targetDir),
  builtAt: new Date().toISOString(),
};
writeFileSync(
  resolve(targetDir, BUILD_DESCRIPTOR_FILE),
  `${JSON.stringify(buildDescriptor, null, 2)}\n`,
  'utf8'
);

function hashExtensionFiles(rootDir) {
  const hash = createHash('sha256');
  for (const filePath of collectFiles(rootDir)) {
    const relativePath = relative(rootDir, filePath).replace(/\\/g, '/');
    if (relativePath === BUILD_DESCRIPTOR_FILE) {
      continue;
    }
    hash.update(relativePath, 'utf8');
    hash.update('\0');
    hash.update(readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Browser extension build contains a symbolic link: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile() && statSync(entryPath).isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}
