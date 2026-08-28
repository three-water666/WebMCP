import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const options = parseOptions(process.argv.slice(2));
const extensionPath = path.resolve(options.extensionPath);
let browserContext;
let stopping = false;

try {
  await fs.mkdir(options.profilePath, { recursive: true });
  browserContext = await chromium.launchPersistentContext(options.profilePath, {
    executablePath: options.browserPath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--remote-debugging-port=${options.cdpPort}`,
      '--disable-background-networking',
      '--disable-component-update',
      '--no-default-browser-check',
      '--no-first-run',
    ],
    viewport: { width: 1280, height: 900 },
  });

  const { build: extensionBuild, worker: extensionWorker } = await resolveExtensionWorker(
    browserContext,
    options.buildId
  );
  const page = await createCleanTargetPage(browserContext);
  await page.goto(options.bridgeUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForURL(url => url.origin === new URL(options.targetUrl).origin, {
    timeout: 45_000,
  });
  const extensionId = extensionWorker.url().split('/')[2];
  const bridgeSession = await waitForBridgeSession(extensionWorker, {
    gatewayPort: options.gatewayPort,
    siteId: options.siteId,
    targetOrigin: new URL(options.targetUrl).origin,
  });
  await fs.writeFile(options.readyPath, `${JSON.stringify({
    schemaVersion: 1,
    status: 'ready',
    pid: process.pid,
    cdpEndpoint: `http://127.0.0.1:${options.cdpPort}`,
    currentUrl: page.url(),
    extensionBuild,
    extensionId,
    bridgeSession,
    popupUrl: extensionId ? `chrome-extension://${extensionId}/index.html` : undefined,
    profilePath: options.profilePath,
  }, null, 2)}\n`, 'utf8');

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await waitForStopFile(options.stopPath);
  await stop();
} catch (error) {
  await fs.writeFile(options.readyPath, `${JSON.stringify({
    schemaVersion: 1,
    status: 'failed',
    pid: process.pid,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }, null, 2)}\n`, 'utf8').catch(() => undefined);
  await browserContext?.close().catch(() => undefined);
  process.exitCode = 1;
}

async function resolveExtensionWorker(context, expectedBuildId) {
  const deadline = Date.now() + 15_000;
  const observedBuilds = new Map();
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      if (!worker.url().startsWith('chrome-extension://')) {
        continue;
      }
      const build = await readExtensionBuild(worker).catch(() => null);
      if (build?.buildId === expectedBuildId) {
        return { build, worker };
      }
      observedBuilds.set(worker.url(), build);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(
    `The expected browser bridge build did not start: ${JSON.stringify([...observedBuilds.values()])}`
  );
}

async function readExtensionBuild(worker) {
  return worker.evaluate(async () => {
    const response = await fetch(globalThis.chrome.runtime.getURL('qa-build.json'), {
      cache: 'no-store',
    });
    return response.ok ? response.json() : null;
  });
}

async function createCleanTargetPage(context) {
  const restoredPages = context.pages();
  const page = await context.newPage();
  await Promise.all(restoredPages.map(candidate => candidate.close().catch(() => undefined)));
  return page;
}

async function waitForBridgeSession(worker, expected) {
  const deadline = Date.now() + 30_000;
  let lastState;
  while (Date.now() < deadline) {
    lastState = await inspectBridgeSession(worker, expected);
    if (lastState.sessionReady && lastState.siteConfigReady) {
      return lastState;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Browser bridge session did not become ready: ${JSON.stringify(lastState)}`);
}

async function inspectBridgeSession(worker, expected) {
  return worker.evaluate(async ({ gatewayPort, siteId, targetOrigin }) => {
    const tabs = await globalThis.chrome.tabs.query({});
    const targetTab = tabs.find(tab => {
      if (!tab.id || !tab.url) {
        return false;
      }
      try {
        return new URL(tab.url).origin === targetOrigin;
      } catch {
        return false;
      }
    });
    const stored = await globalThis.chrome.storage.local.get(null);
    const session = targetTab?.id ? stored[`session_${targetTab.id}`] : undefined;
    const sites = Array.isArray(stored.syncedAiSites) ? stored.syncedAiSites : [];
    const siteConfig = sites.find(candidate => candidate?.id === siteId);
    return {
      tabId: targetTab?.id ?? null,
      targetUrl: targetTab?.url ?? null,
      sessionReady: Boolean(
        session &&
        session.port === gatewayPort &&
        session.siteId === siteId &&
        session.targetOrigin === targetOrigin
      ),
      siteConfigReady: Boolean(siteConfig?.selectors),
    };
  }, expected);
}

async function waitForStopFile(stopPath) {
  while (!stopping) {
    try {
      await fs.access(stopPath);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  await browserContext?.close().catch(() => undefined);
}

function parseOptions(args) {
  const values = Object.fromEntries(args.map(argument => {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) {
      throw new Error(`Invalid QA browser host argument: ${argument}`);
    }
    return [argument.slice(2, separator), argument.slice(separator + 1)];
  }));
  const required = [
    'bridgeUrl',
    'buildId',
    'browserPath',
    'cdpPort',
    'extensionPath',
    'gatewayPort',
    'profilePath',
    'readyPath',
    'siteId',
    'stopPath',
    'targetUrl',
  ];
  for (const name of required) {
    if (!values[name]) {
      throw new Error(`Missing QA browser host option --${name}.`);
    }
  }
  return {
    ...values,
    cdpPort: Number(values.cdpPort),
    gatewayPort: Number(values.gatewayPort),
  };
}
