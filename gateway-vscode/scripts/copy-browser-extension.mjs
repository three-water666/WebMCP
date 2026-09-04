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
// Public identity key for the VSIX-bundled unpacked bridge only. Keeping this value stable
// keeps its extension id (joieheegaphjokbcbklegmphhgpdfcon) independent of install paths.
const BUNDLED_EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAolDT+vb34R3fJYGyO3BMcM42eBrjiqdsjg2Ux6297E2TRuldLEobbCVqKRuaoHrdfzXD6FjonA4564IP+cJa+AvL0ClPqM1aJZSink4AAXEyL7Yu2/Wbcm+KBm4aB/ltjNXMIM3IaxoJk5ktzPH5fBTHq+WkqUrGm3UoBXYZOfsWWuU0KYKl3cV3ua4/4hM0Om/lf9dcv3fIfxMfQtTEvnfDcrTzjmh1XvFLZdpApDOaiFf8hpeVcAHa/BDXKXHHWrl1ZjspSjEn2Y05DDZ77xUTDPVGQvOmxE4iPJSFFraJrugpTJ3oNxZ5t4+4RDhR17dCadGzShhJIT72ReZH7wIDAQAB';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(scriptDir, '..');
const repoRoot = resolve(extensionRoot, '..');
const sourceDir = resolve(repoRoot, 'bridge-browser', 'dist');
const targetDir = resolve(extensionRoot, 'browser-extension');
const bridgeProtocolPath = resolve(repoRoot, 'shared', 'src', 'bridgeProtocol.json');

if (!existsSync(resolve(sourceDir, 'manifest.json'))) {
  throw new Error(`Browser extension build not found at ${sourceDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

const manifestPath = resolve(targetDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.key = BUNDLED_EXTENSION_PUBLIC_KEY;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

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
