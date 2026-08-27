import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  requestControl,
  resolveRun,
  runPlaywright,
  updateRunManifest,
  waitForProcessExit,
} from './qa-common.mjs';

const [runArgument] = process.argv.slice(2);
if (!runArgument || runArgument === '--help' || runArgument === '-h') {
  console.log('Usage: pnpm qa:stop <run>');
  process.exit(0);
}

const run = await resolveRun(runArgument);
const sessions = run.manifest.sessions ?? {};

await fs.writeFile(path.join(run.runDirectory, 'browser-host.stop'), 'stop\n', 'utf8');
await requestControl(run.manifest, 'stop').catch(() => undefined);
await detachSession(sessions.browser);
await detachSession(sessions.vscode);
const processStates = await waitForRunProcesses(run.manifest.processes ?? {});
const allStopped = Object.values(processStates).every(state => state.stopped);
await fs.appendFile(run.manifest.tracePath, `${JSON.stringify({
  timestamp: new Date().toISOString(),
  runId: run.manifest.runId,
  source: 'qa-runner',
  event: 'qa_session_stopped',
  status: allStopped ? 'success' : 'failed',
})}\n`, 'utf8').catch(() => undefined);
await updateRunManifest(run.runDirectory, {
  status: allStopped ? 'stopped' : 'stop-incomplete',
  completedAt: new Date().toISOString(),
  stopProcesses: processStates,
});

console.log(`Interactive QA session ${allStopped ? 'stopped' : 'stop incomplete'}: ${run.manifest.runId}`);
console.log(`Run artifacts: ${run.runDirectory}`);

async function detachSession(sessionName) {
  if (!sessionName) {
    return;
  }
  const result = await runPlaywright(sessionName, ['detach'], { capture: true });
  if (result.code !== 0 && !/not found|no session|does not exist/i.test(result.stderr + result.stdout)) {
    console.warn(`Could not detach ${sessionName}: ${result.stderr || result.stdout}`);
  }
}

async function waitForRunProcesses(processes) {
  const states = await Promise.all(Object.entries(processes).map(async ([name, processId]) => [
    name,
    {
      processId,
      stopped: await waitForProcessExit(processId),
    },
  ]));
  return Object.fromEntries(states);
}
