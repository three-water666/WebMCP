import { defineConfig, type Plugin } from 'vite';
import { crx, defineManifest } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

interface SharedBrandingConfig {
  productName: string;
  slug: string;
  repositoryUrl: string;
}

interface SharedBridgeProtocolConfig {
  version: number;
}

const sharedIndexPath = normalizePath(resolve(__dirname, '../shared/src/index.ts'));
const sharedBrandingPath = resolve(__dirname, '../shared/src/branding.json');
const sharedBridgeProtocolPath = resolve(__dirname, '../shared/src/bridgeProtocol.json');
const sharedBrandingConfig = JSON.parse(readFileSync(sharedBrandingPath, 'utf8')) as SharedBrandingConfig;
const sharedBridgeProtocolConfig = JSON.parse(
  readFileSync(sharedBridgeProtocolPath, 'utf8')
) as SharedBridgeProtocolConfig;
const extensionManifest = defineManifest({
  ...manifest,
  content_scripts: manifest.content_scripts.map(script => ({
    ...script,
    world: script.world === 'MAIN' ? 'MAIN' as const : undefined,
  })),
});

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function inlineSharedConfig(): Plugin {
  return {
    name: 'webcode:inline-shared-config',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (normalizePath(id).split('?')[0] !== sharedIndexPath) {
        return null;
      }

      // CRXJS dev file-writer treats Vite's external-root JSON imports as assets
      // and reads them from this package root. Inline these tiny configs in dev.
      return code
        .replace(
          /import\s+brandConfig\s+from\s+['"]\.\/branding\.json['"];?/,
          `const brandConfig = ${JSON.stringify(sharedBrandingConfig)} as const;`
        )
        .replace(
          /import\s+bridgeProtocolConfig\s+from\s+['"]\.\/bridgeProtocol\.json['"];?/,
          `const bridgeProtocolConfig = ${JSON.stringify(sharedBridgeProtocolConfig)} as const;`
        );
    },
  };
}

export default defineConfig({
  plugins: [inlineSharedConfig(), crx({ manifest: extensionManifest })],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
      },
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      }
    }
  },
  resolve: {
    alias: {
      '@': '/src',
      '@webcode/shared': resolve(__dirname, '../shared/src/index.ts')
    }
  }
});
