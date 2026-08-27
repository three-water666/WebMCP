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

const sharedIndexPath = normalizePath(resolve(__dirname, '../shared/src/index.ts'));
const sharedBrandingPath = resolve(__dirname, '../shared/src/branding.json');
const sharedBrandingConfig = JSON.parse(readFileSync(sharedBrandingPath, 'utf8')) as SharedBrandingConfig;
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

function inlineSharedBrandingConfig(): Plugin {
  return {
    name: 'webcode:inline-shared-branding-config',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (normalizePath(id).split('?')[0] !== sharedIndexPath) {
        return null;
      }

      // CRXJS dev file-writer treats Vite's external-root JSON import
      // (/@fs/.../branding.json?import) as an asset and reads it from this
      // package root. Inline this tiny config in dev to avoid that bad path.
      return code.replace(
        /import\s+brandConfig\s+from\s+['"]\.\/branding\.json['"];?/,
        `const brandConfig = ${JSON.stringify(sharedBrandingConfig)} as const;`
      );
    },
  };
}

export default defineConfig({
  plugins: [inlineSharedBrandingConfig(), crx({ manifest: extensionManifest })],
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
