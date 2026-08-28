import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function resolveBrowserPath() {
  const configured = process.env.WEBCODE_EVAL_BROWSER_PATH?.trim();
  const candidates = configured ? [configured] : getBrowserCandidates();
  const resolved = candidates.find(candidate => candidate && existsSync(candidate));
  if (!resolved) {
    throw new Error([
      configured
        ? `The browser executable configured by WEBCODE_EVAL_BROWSER_PATH does not exist: ${configured}`
        : 'No local Edge, Chrome, or Chromium executable was found in the default locations.',
      'Set WEBCODE_EVAL_BROWSER_PATH to the full path of an installed browser executable and retry.',
    ].join(' '));
  }
  return resolved;
}

export function resolveVsCodePath() {
  const configured = process.env.WEBCODE_EVAL_VSCODE_PATH?.trim();
  if (configured === 'download') {
    return undefined;
  }
  const candidates = configured ? [configured] : getVsCodeCandidates();
  const resolved = candidates.find(candidate => candidate && existsSync(candidate));
  if (!resolved) {
    throw new Error([
      configured
        ? `The VS Code executable configured by WEBCODE_EVAL_VSCODE_PATH does not exist: ${configured}`
        : 'No local VS Code executable was found in the default locations.',
      'Set WEBCODE_EVAL_VSCODE_PATH to the full path of an installed VS Code executable and retry.',
      'Set WEBCODE_EVAL_VSCODE_PATH=download only when downloading the fixed test runtime is intended.',
    ].join(' '));
  }
  return resolved;
}

function getBrowserCandidates() {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

function getVsCodeCandidates() {
  if (process.platform === 'win32') {
    return [
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
        : '',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron'];
  }
  return ['/usr/bin/code', '/usr/share/code/code'];
}
