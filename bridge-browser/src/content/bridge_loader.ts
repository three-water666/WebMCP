import { BRANDING, BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';
import { type HandshakeResponse } from '../types';

type BridgeLoaderI18n = {
  invalidLinkParameters: string;
  extensionNotDetectedTitle: string;
  extensionNotDetectedDesc: string;
  connectedRedirecting: string;
  connectionConflictTitle: string;
  connectionConflictBody: (port: number) => string;
  versionMismatchTitle: string;
  browserBridgeOutdatedBody: (vscodeVersion: string, browserVersion: string) => string;
  vscodeExtensionOutdatedBody: (vscodeVersion: string, browserVersion: string) => string;
  protocolMismatchBody: (gatewayProtocol: string, browserProtocol: number) => string;
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
  bridgeProtocolVersion: number;
  vscodeExtensionVersion: string;
  browserExtensionVersion: string;
};

type ReadHandshakeParamsResult =
  | { status: "ready"; params: HandshakeParams }
  | { status: "invalid" }
  | {
      status: "version-mismatch";
      reason: "browser-outdated" | "vscode-outdated" | "protocol-mismatch";
      vscodeExtensionVersion: string;
      browserExtensionVersion: string;
      gatewayProtocolVersion?: number;
    };

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
    browserBridgeOutdatedBody: (vscodeVersion: string, browserVersion: string) =>
      `VS Code extension: ${vscodeVersion}<br>Browser bridge: ${browserVersion}<br>The browser bridge is older. For an isolated browser, return to VS Code and restart it; otherwise update the browser extension.`,
    vscodeExtensionOutdatedBody: (vscodeVersion: string, browserVersion: string) =>
      `VS Code extension: ${vscodeVersion}<br>Browser bridge: ${browserVersion}<br>Update or reload the VS Code extension, then reconnect.`,
    protocolMismatchBody: (gatewayProtocol: string, browserProtocol: number) =>
      `VS Code bridge protocol: ${gatewayProtocol}<br>Browser bridge protocol: ${browserProtocol}<br>Update the older extension. For an isolated browser, restart it from VS Code.`,
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
    browserBridgeOutdatedBody: (vscodeVersion: string, browserVersion: string) =>
      `VS Code 扩展：${vscodeVersion}<br>浏览器桥接：${browserVersion}<br>浏览器桥接版本较旧。如果使用隔离浏览器，请回到 VS Code 重启隔离浏览器；否则请更新浏览器扩展。`,
    vscodeExtensionOutdatedBody: (vscodeVersion: string, browserVersion: string) =>
      `VS Code 扩展：${vscodeVersion}<br>浏览器桥接：${browserVersion}<br>请更新或重新加载 VS Code 扩展，然后重新连接。`,
    protocolMismatchBody: (gatewayProtocol: string, browserProtocol: number) =>
      `VS Code 桥接协议：${gatewayProtocol}<br>浏览器桥接协议：${browserProtocol}<br>请更新较旧的一端；隔离浏览器请从 VS Code 中重启。`,
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
  const vscodeExtensionVersion = bridgeData.currentVscodeExtensionVersion ?? bridgeData.vscodeExtensionVersion;
  const gatewayProtocolVersion = bridgeData.bridgeProtocolVersion;
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
      reason: "protocol-mismatch",
      vscodeExtensionVersion: "unknown",
      browserExtensionVersion,
    };
  }

  if (gatewayProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    return {
      status: "version-mismatch",
      reason: "protocol-mismatch",
      vscodeExtensionVersion,
      browserExtensionVersion,
      gatewayProtocolVersion,
    };
  }

  if (vscodeExtensionVersion !== browserExtensionVersion) {
    return {
      status: "version-mismatch",
      reason: compareVersions(vscodeExtensionVersion, browserExtensionVersion) > 0
        ? "browser-outdated"
        : "vscode-outdated",
      vscodeExtensionVersion,
      browserExtensionVersion,
    };
  }

  return {
    status: "ready",
    params: {
      port: Number.parseInt(portStr, 10),
      bridgeCode,
      bridgeProtocolVersion: gatewayProtocolVersion,
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
      bridgeProtocolVersion: params.bridgeProtocolVersion,
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
                            <span style="font-size:0.8em; opacity:0.8">${getVersionMismatchBody(result)}</span>
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

function getVersionMismatchBody(
  result: Extract<ReadHandshakeParamsResult, { status: "version-mismatch" }>
): string {
  if (result.reason === "browser-outdated") {
    return i18n.browserBridgeOutdatedBody(result.vscodeExtensionVersion, result.browserExtensionVersion);
  }
  if (result.reason === "vscode-outdated") {
    return i18n.vscodeExtensionOutdatedBody(result.vscodeExtensionVersion, result.browserExtensionVersion);
  }
  return i18n.protocolMismatchBody(
    result.gatewayProtocolVersion?.toString() ?? "unknown",
    BRIDGE_PROTOCOL_VERSION
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseNumericVersion(left);
  const rightParts = parseNumericVersion(right);
  if (!leftParts || !rightParts) {
    return 0;
  }
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function parseNumericVersion(version: string): number[] | null {
  return /^\d+(?:\.\d+){1,3}$/.test(version) ? version.split(".").map(Number) : null;
}

function readBridgeData(): Partial<HandshakeParams> & { currentVscodeExtensionVersion?: string } {
  const dataEl = document.getElementById("mcp-data");
  const rawData = dataEl?.textContent ?? "";
  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!isRecord(parsed)) {
      return {};
    }

    return {
      vscodeExtensionVersion: readBridgeDataString(parsed, "vscodeExtensionVersion"),
      currentVscodeExtensionVersion: readBridgeDataString(parsed, "currentVscodeExtensionVersion"),
      bridgeProtocolVersion: readBridgeDataNumber(parsed, "bridgeProtocolVersion"),
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

function readBridgeDataNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
