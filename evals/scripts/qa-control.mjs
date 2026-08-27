import fs from 'node:fs/promises';
import process from 'node:process';

import { isProcessRunning, printJson, requestControl, resolveRun } from './qa-common.mjs';

const [runArgument, ...arguments_] = process.argv.slice(2);
if (!runArgument || runArgument === '--help' || runArgument === '-h') {
  printUsage();
  process.exit(0);
}

const run = await resolveRun(runArgument);
const command = arguments_[0] ?? 'status';
const commandArguments = arguments_.slice(1);

switch (command) {
  case 'status':
    await printStatus();
    break;
  case 'manifest':
    printJson(redactManifest(run.manifest));
    break;
  case 'popup-url':
    printJson({ popupUrl: run.manifest.popupUrl ?? null });
    break;
  case 'trace':
    await printTrace(commandArguments);
    break;
  case 'vscode':
    await runVsCodeCommand(commandArguments);
    break;
  case 'gateway':
    await runGatewayCommand(commandArguments);
    break;
  case 'site':
    await runSiteCommand(commandArguments);
    break;
  default:
    throw new Error(`Unknown qa:ctl command: ${command}`);
}

async function printStatus() {
  let live;
  let controlError;
  try {
    live = await requestControl(run.manifest, 'status');
  } catch (error) {
    controlError = error instanceof Error ? error.message : String(error);
  }
  const processes = Object.fromEntries(
    Object.entries(run.manifest.processes ?? {}).map(([name, processId]) => [name, {
      processId,
      running: isProcessRunning(processId),
    }])
  );
  const degraded = run.manifest.status === 'running' && (
    Boolean(controlError) || Object.values(processes).some(processState => !processState.running)
  );
  printJson({
    run: {
      runId: run.manifest.runId,
      siteId: run.manifest.siteId,
      status: run.manifest.status,
      workspacePath: run.manifest.workspacePath,
      popupUrl: run.manifest.popupUrl ?? null,
      sessions: run.manifest.sessions,
      health: degraded ? 'degraded' : run.manifest.status,
      processes,
    },
    live: live ?? null,
    controlError,
  });
}

async function printTrace(args) {
  const tail = readPositiveInteger(args[0], 30);
  const content = await fs.readFile(run.manifest.tracePath, 'utf8').catch(() => '');
  const events = content.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  printJson(events.slice(-tail));
}

async function runVsCodeCommand(args) {
  switch (args[0] ?? 'state') {
    case 'state':
      printJson(await requestControl(run.manifest, 'status'));
      return;
    case 'command':
      printJson(await requestControl(run.manifest, 'vscode.command', {
        command: requireArgument(args[1], 'VS Code command id'),
        arguments: parseJson(args[2] ?? '[]', 'command arguments'),
      }));
      return;
    case 'config':
      await runConfigurationCommand(args.slice(1));
      return;
    case 'open':
      printJson(await requestControl(run.manifest, 'vscode.openFile', {
        path: requireArgument(args[1], 'file path'),
        line: readPositiveInteger(args[2], 1),
        column: readPositiveInteger(args[3], 1),
      }));
      return;
    default:
      throw new Error(`Unknown VS Code control command: ${args[0]}`);
  }
}

async function runConfigurationCommand(args) {
  const operation = args[0];
  const key = requireArgument(args[1], 'configuration key');
  if (operation === 'get') {
    printJson(await requestControl(run.manifest, 'vscode.config.get', { key }));
    return;
  }
  if (operation === 'set') {
    printJson(await requestControl(run.manifest, 'vscode.config.set', {
      key,
      value: parseJson(requireArgument(args[2], 'JSON value'), 'configuration value'),
      target: args[3] ?? 'global',
    }));
    return;
  }
  throw new Error('Usage: vscode config <get|set> <key> [json-value] [global|workspace|folder]');
}

async function runGatewayCommand(args) {
  if (args[0] !== 'stop') {
    throw new Error('Usage: gateway stop');
  }
  printJson(await requestControl(run.manifest, 'gateway.stop'));
}

async function runSiteCommand(args) {
  if (args[0] !== 'start') {
    throw new Error('Usage: site start [site-id]');
  }
  printJson(await requestControl(run.manifest, 'site.start', {
    siteId: args[1] ?? run.manifest.siteId,
  }));
}

function requireArgument(value, name) {
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function parseJson(value, description) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON for ${description}: ${value}`);
  }
}

function readPositiveInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Expected a positive integer, received ${value}.`);
  }
  return number;
}

function printUsage() {
  console.log('Usage: pnpm qa:ctl <run> [status|manifest|popup-url|trace [tail]]');
  console.log('       pnpm qa:ctl <run> vscode state');
  console.log('       pnpm qa:ctl <run> vscode command <id> [json-array]');
  console.log('       pnpm qa:ctl <run> vscode config get <key>');
  console.log('       pnpm qa:ctl <run> vscode config set <key> <json> [target]');
  console.log('       pnpm qa:ctl <run> vscode open <path> [line] [column]');
}

function redactManifest(manifest) {
  return {
    ...manifest,
    bridgeUrl: redactUrlSecret(manifest.bridgeUrl),
    control: manifest.control ? { ...manifest.control, token: '[redacted]' } : undefined,
  };
}

function redactUrlSecret(value) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.searchParams.has('bridgeToken')) {
      url.searchParams.set('bridgeToken', '[redacted]');
    }
    return url.toString();
  } catch {
    return value;
  }
}
