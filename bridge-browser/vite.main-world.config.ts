import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/page/network_capture.ts'),
      fileName: () => 'network_capture_main.js',
      formats: ['iife'],
      name: 'WebcodeNetworkCapture',
    },
    minify: 'esbuild',
    outDir: resolve(__dirname, 'public/generated'),
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@webcode/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
