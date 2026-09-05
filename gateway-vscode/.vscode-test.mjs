import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resolveVsCodePath } from '../evals/scripts/runtime-paths.mjs';

const version = process.env.VSCODE_TEST_VERSION?.trim() || '1.106.1';
const extensionRoot = fileURLToPath(new URL('.', import.meta.url));
const vscodeExecutablePath = resolveVsCodePath();

export default defineConfig({
	files: 'out/extension-test/**/*.test.js',
	version,
	workspaceFolder: fileURLToPath(new URL('./src/extension-test/workspace', import.meta.url)),
	...(vscodeExecutablePath
		? { useInstallation: { fromPath: vscodeExecutablePath } }
		: {}),
	env: {
		WEBCODE_BROWSER_EXTENSION_ROOT: path.join(extensionRoot, '.vscode-test', 'browser-extensions'),
	},
	mocha: {
		timeout: 20_000,
	},
});
