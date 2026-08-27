import process from 'node:process';

import { resolveRun, runPlaywright } from './qa-common.mjs';

const [runArgument, target, ...playwrightArguments] = process.argv.slice(2);

if (!runArgument || runArgument === '--help' || runArgument === '-h') {
  console.log('Usage: pnpm qa:pw <run> <browser|vscode> <playwright-cli command...>');
  console.log('Example: pnpm qa:pw <run> browser snapshot');
  process.exit(0);
}
if (target !== 'browser' && target !== 'vscode') {
  throw new Error('QA Playwright target must be browser or vscode.');
}
if (playwrightArguments.length === 0) {
  throw new Error('Missing Playwright CLI command. Try snapshot, screenshot, console, or requests.');
}

const { manifest } = await resolveRun(runArgument);
const sessionName = manifest.sessions?.[target];
if (!sessionName) {
  throw new Error(`Run ${manifest.runId} does not define a ${target} Playwright session.`);
}
const result = await runPlaywright(sessionName, playwrightArguments);
process.exitCode = result.code;
