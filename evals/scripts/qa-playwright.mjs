import process from 'node:process';
import path from 'node:path';

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
const normalizedArguments = normalizeArtifactPath(playwrightArguments, manifest, target);
let result = await runPlaywright(sessionName, normalizedArguments, { capture: true });
if (shouldReattach(normalizedArguments, result)) {
  const endpoint = manifest.endpoints?.[`${target}Cdp`];
  const configPath = manifest.playwrightConfigs?.[target];
  if (endpoint && configPath) {
    const attachResult = await runPlaywright(sessionName, [
      'attach',
      `--cdp=${endpoint}`,
      `--config=${configPath}`,
    ], { capture: true });
    printResult(attachResult);
    if (attachResult.code === 0) {
      result = await runPlaywright(sessionName, normalizedArguments, { capture: true });
    }
  }
}
printResult(result);
process.exitCode = result.code;

function normalizeArtifactPath(args, manifestValue, targetName) {
  if (args[0] !== 'screenshot' || !manifestValue.artifactsDirectory) {
    return args;
  }
  const normalized = [...args];
  const outputDirectory = path.join(manifestValue.artifactsDirectory, targetName);
  const inlineIndex = normalized.findIndex(argument => argument.startsWith('--filename='));
  if (inlineIndex >= 0) {
    const fileName = normalized[inlineIndex].slice('--filename='.length);
    if (fileName && !path.isAbsolute(fileName)) {
      normalized[inlineIndex] = `--filename=${path.join(outputDirectory, fileName)}`;
    }
    return normalized;
  }
  const optionIndex = normalized.indexOf('--filename');
  if (optionIndex >= 0 && normalized[optionIndex + 1] && !path.isAbsolute(normalized[optionIndex + 1])) {
    normalized[optionIndex + 1] = path.join(outputDirectory, normalized[optionIndex + 1]);
  }
  return normalized;
}

function shouldReattach(args, resultValue) {
  if (['attach', 'detach', 'close', 'delete-data', 'open'].includes(args[0])) {
    return false;
  }
  return resultValue.code !== 0 && /browser .* is not open|please run open first/i.test(
    `${resultValue.stdout}\n${resultValue.stderr}`
  );
}

function printResult(resultValue) {
  if (resultValue.stdout) {
    process.stdout.write(resultValue.stdout);
  }
  if (resultValue.stderr) {
    process.stderr.write(resultValue.stderr);
  }
}
