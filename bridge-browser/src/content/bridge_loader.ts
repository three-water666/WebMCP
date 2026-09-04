import { BRANDING } from '@webcode/shared';
import { type HandshakeResponse } from '../types';

type BridgeLoaderI18n = {
  invalidLinkParameters: string;
  extensionNotDetectedTitle: string;
  extensionNotDetectedDesc: string;
  connectedRedirecting: string;
  connectionConflictTitle: string;
  connectionConflictBody: (port: number) => string;
  versionMismatchTitle: string;
  versionMismatchBody: (vscodeVersion: string, browserVersion: string) => string;
  connectHere: string;
  switchingConnection: string;
  connectionFailed: (message: string) => string;
  unknownError: string;
};

type HandshakeElements = {
  loader: HTMLElement | null;
  statusText: HTMLElement | null;
  card: HTMLElement | null;
};

type ReadyHandshakeElements = {
  loader: HTMLElement;
  statusText: HTMLElement;
  card: HTMLElement;
};

type HandshakeParams = {
  port: number;
  bridgeCode: string;
  vscodeExtensionVersion: string;
  browserExtensionVersion: string;
};

type ReadHandshakeParamsResult =
  | { status: "ready"; params: HandshakeParams }
  | { status: "invalid" }
  | { status: "version-mismatch"; vscodeExtensionVersion: string; browserExtensionVersion: string };

const I18N: Record<"en" | "zh", BridgeLoaderI18n> = {
  en: {
    invalidLinkParameters: "Invalid Link Parameters",
    extensionNotDetectedTitle: "❌ Extension Not Detected",
    extensionNotDetectedDesc: `Please ensure '${BRANDING.bridgeName}' extension is installed and enabled.`,
    connectedRedirecting: "✅ Connected! Redirecting...",
    connectionConflictTitle: "⚠️ Connection Conflict",
    connectionConflictBody: (port: number) =>
      `VS Code (Port ${port}) is already connected to another tab.<br>Do you want to switch the connection here?`,
    versionMismatchTitle: "Version Mismatch",
    versionMismatchBody: (vscodeVersion: string, browserVersion: string) =>
      `VS Code extension version: ${vscodeVersion}<br>Browser extension version: ${browserVersion}<br>Please update both extensions to the same version, then reconnect.`,
    connectHere: "Yes, Connect Here",
    switchingConnection: "Switching connection...",
    connectionFailed: (message: string) => `Connection Failed: ${message}`,
    unknownError: "Unknown Error",
  },
  zh: {
    invalidLinkParameters: "链接参数无效",
    extensionNotDetectedTitle: "❌ 未检测到扩展",
    extensionNotDetectedDesc: `请确认已安装并启用 “${BRANDING.bridgeName}” 浏览器扩展。`,
    connectedRedirecting: "✅ 已连接，正在跳转...",
    connectionConflictTitle: "⚠️ 连接冲突",
    connectionConflictBody: (port: number) => `VS Code（端口 ${port}）当前已连接到另一个标签页。<br>要切换到这个页面吗？`,
    versionMismatchTitle: "版本不一致",
    versionMismatchBody: (vscodeVersion: string, browserVersion: string) =>
      `VS Code 扩展版本：${vscodeVersion}<br>浏览器扩展版本：${browserVersion}<br>请将两个扩展升级到相同版本后重新连接。`,
    connectHere: "是的，连接到这里",
    switchingConnection: "正在切换连接...",
    connectionFailed: (message: string) => `连接失败：${message}`,
    unknownError: "未知错误",
  },
};

const i18n = I18N[navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"];

document.documentElement.setAttribute("data-extension-installed", "true");

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startHandshake);
} else {
  startHandshake();
}

function startHandshake(): void {
  console.log(`${BRANDING.logPrefix} Bridge starting handshake...`);

  const elements = getHandshakeElements();
  const paramsResult = readHandshakeParams();
  if (paramsResult.status === "invalid") {
    showInvalidLinkParameters(elements.statusText);
    return;
  }
  if (paramsResult.status === "version-mismatch") {
    showVersionMismatch(paramsResult, elements);
    return;
  }

  attemptHandshake(paramsResult.params, elements);
}

function getHandshakeElements(): HandshakeElements {
  return {
    loader: document.getElementById("loader"),
    statusText: document.querySelector("p"),
    card: document.getElementById("main-card"),
  };
}

function readHandshakeParams(): ReadHandshakeParamsResult {
  const params = new URLSearchParams(window.location.search);
  const bridgeData = readBridgeData();
  const bridgeCode = params.get("bridgeCode");
  const vscodeExtensionVersion = bridgeData.vscodeExtensionVersion;
  const browserExtensionVersion = chrome.runtime.getManifest().version;
  const portStr = window.location.port;

  if (bridgeCode) {
    stripBridgeCodeFromAddressBar();
  }

  if (!bridgeCode || !portStr) {
    return { status: "invalid" };
  }

  if (!vscodeExtensionVersion) {
    return {
      status: "version-mismatch",
      vscodeExtensionVersion: "unknown",
      browserExtensionVersion,
    };
  }

  if (vscodeExtensionVersion !== browserExtensionVersion) {
    return {
      status: "version-mismatch",
      vscodeExtensionVersion,
      browserExtensionVersion,
    };
  }

  return {
    status: "ready",
    params: {
      port: Number.parseInt(portStr, 10),
      bridgeCode,
      vscodeExtensionVersion,
      browserExtensionVersion,
    },
  };
}

function stripBridgeCodeFromAddressBar(): void {
  window.history.replaceState(null, document.title, window.location.pathname);
}

function attemptHandshake(params: HandshakeParams, elements: HandshakeElements, force = false): void {
  chrome.runtime.sendMessage(
    {
      type: "HANDSHAKE",
      port: params.port,
      bridgeCode: params.bridgeCode,
      vscodeExtensionVersion: params.vscodeExtensionVersion,
      browserExtensionVersion: params.browserExtensionVersion,
      force,
    },
    (response: HandshakeResponse) => {
      handleHandshakeResponse(response, params, elements);
    }
  );
}

function showVersionMismatch(
  result: Extract<ReadHandshakeParamsResult, { status: "version-mismatch" }>,
  elements: HandshakeElements
): void {
  if (!elements.statusText || !elements.loader) {
    return;
  }

  document.body.dataset.bridgeState = "error";
  elements.loader.style.display = "none";
  elements.statusText.innerHTML = `
                            <span style="color:#ff6b6b">${i18n.versionMismatchTitle}</span><br>
                            <span style="font-size:0.8em; opacity:0.8">${i18n.versionMismatchBody(
                              result.vscodeExtensionVersion,
                              result.browserExtensionVersion
                            )}</span>
                        `;
}

function handleHandshakeResponse(
  response: HandshakeResponse,
  params: HandshakeParams,
  elements: HandshakeElements
): void {
  if (chrome.runtime.lastError) {
    showExtensionNotDetected(elements);
    return;
  }

  if (!hasReadyHandshakeElements(elements)) {
    return;
  }

  if (response?.success) {
    if (!response.targetUrl) {
      showConnectionFailed({ success: false, error: i18n.unknownError }, elements);
      return;
    }
    showConnected(response.targetUrl, elements);
  } else if (response?.error === "BUSY") {
    showConnectionConflict(params, elements);
  } else {
    showConnectionFailed(response, elements);
  }
}

function showInvalidLinkParameters(statusText: HTMLElement | null): void {
  if (!statusText) {
    return;
  }

  statusText.innerText = i18n.invalidLinkParameters;
  statusText.style.color = "#ff6b6b";
}

function showExtensionNotDetected(elements: HandshakeElements): void {
  console.error(`${BRANDING.logPrefix} Runtime error during handshake:`, chrome.runtime.lastError);
  if (!elements.statusText || !elements.loader) {
    return;
  }

  document.body.dataset.bridgeState = "error";
  elements.statusText.innerHTML = `
                            <span style="color:#ff6b6b">${i18n.extensionNotDetectedTitle}</span><br>
                            <span style="font-size:0.8em; opacity:0.8">${i18n.extensionNotDetectedDesc}</span>
                        `;
  elements.loader.style.display = "none";
}

function hasReadyHandshakeElements(elements: HandshakeElements): elements is ReadyHandshakeElements {
  return Boolean(elements.statusText && elements.loader && elements.card);
}

function showConnected(target: string, elements: ReadyHandshakeElements): void {
  document.body.dataset.bridgeState = "connected";
  elements.statusText.innerText = i18n.connectedRedirecting;
  elements.statusText.style.color = "#4CAF50";
  setTimeout(() => {
    window.location.href = target;
  }, 500);
}

function showConnectionConflict(params: HandshakeParams, elements: ReadyHandshakeElements): void {
  document.body.dataset.bridgeState = "conflict";
  elements.loader.style.display = "none";
  elements.statusText.innerHTML = `
                        <span style="color:#f39c12; font-weight:bold">${i18n.connectionConflictTitle}</span><br><br>
                        ${i18n.connectionConflictBody(params.port)}
                    `;

  elements.card.querySelector("button")?.remove();
  elements.card.appendChild(createConnectHereButton(params, elements));
}

function createConnectHereButton(params: HandshakeParams, elements: HandshakeElements): HTMLButtonElement {
  const button = document.createElement("button");
  button.innerText = i18n.connectHere;
  button.style.marginTop = "20px";
  button.onclick = () => {
    document.body.dataset.bridgeState = "switching";
    if (elements.statusText) {
      elements.statusText.innerText = i18n.switchingConnection;
    }
    if (elements.loader) {
      elements.loader.style.display = "block";
    }
    button.remove();
    attemptHandshake(params, elements, true);
  };
  return button;
}

function showConnectionFailed(response: HandshakeResponse, elements: ReadyHandshakeElements): void {
  document.body.dataset.bridgeState = "error";
  elements.statusText.innerText = i18n.connectionFailed(response?.error ?? i18n.unknownError);
  elements.statusText.style.color = "#ff6b6b";
}

function readBridgeData(): Pick<Partial<HandshakeParams>, "vscodeExtensionVersion"> {
  const dataEl = document.getElementById("mcp-data");
  const rawData = dataEl?.textContent ?? "";
  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!isRecord(parsed)) {
      return {};
    }

    return {
      vscodeExtensionVersion: readBridgeDataString(parsed, "vscodeExtensionVersion"),
    };
  } catch {
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBridgeDataString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value ? value : undefined;
}
