import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig } from "vite";

const testDirectory = resolve(__dirname, "test");

function findTestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return findTestFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [entryPath] : [];
  });
}

const testInputs = Object.fromEntries(
  findTestFiles(testDirectory)
    .sort()
    .map((filePath) => [
      relative(testDirectory, filePath).replace(/\.ts$/, "").replaceAll("\\", "/"),
      filePath,
    ])
);

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    modulePreload: false,
    outDir: "out/runtime-tests",
    rollupOptions: {
      input: testInputs,
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "[name].js",
      },
    },
    target: "es2022",
  },
  publicDir: false,
  resolve: {
    alias: {
      "@webcode/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
