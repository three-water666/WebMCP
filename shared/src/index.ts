// 通用通信协议定义

import brandConfig from './branding.json';

export * from './chatgptStream';
export * from './deepseekStream';
export * from './networkCapture';
export * from './sse';

function toHeaderToken(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export const BRANDING = {
  productName: brandConfig.productName,
  slug: brandConfig.slug,
  gatewayName: `${brandConfig.productName} gateway`,
  bridgeName: `${brandConfig.productName} bridge`,
  settingsName: `${brandConfig.productName} Settings`,
  managerName: `${brandConfig.productName} Manager`,
  serverName: `${brandConfig.productName} Server`,
  notificationName: `${brandConfig.productName} Notification`,
  terminalPrefix: brandConfig.productName,
  resultFilePrefix: `${brandConfig.slug}-result`,
  logPrefix: `[${brandConfig.productName}]`,
  slashCommand: `/${brandConfig.slug}`,
  mentionCommand: `@${brandConfig.slug}`,
  repositoryUrl: brandConfig.repositoryUrl,
} as const;

const headerToken = toHeaderToken(brandConfig.productName);

export const PROTOCOL = {
  initToolName: `${brandConfig.slug}_init`,
  authHeaderName: `X-${headerToken}-Token`,
  authHeaderLowerName: `x-${headerToken.toLowerCase()}-token`,
  observerStartedFlag: `_${brandConfig.slug}_observer_started`,
  networkCaptureConfigMessage: `${brandConfig.slug}:network-capture-config`,
  networkCaptureEventMessage: `${brandConfig.slug}:network-capture-event`,
  networkCaptureReadyMessage: `${brandConfig.slug}:network-capture-ready`,
} as const;

export const PLATFORM_PROMPT_KEY_PREFIX = 'platform_prompt_';

export type PromptLanguage = 'zh' | 'en';

export function getPlatformPromptStorageKey(
  siteId: string | null | undefined,
  lang: PromptLanguage
): string | null {
  const normalizedSiteId = normalizePromptSiteId(siteId);
  return normalizedSiteId ? `${PLATFORM_PROMPT_KEY_PREFIX}${normalizedSiteId}_${lang}` : null;
}

export function joinPromptSections(...sections: Array<string | null | undefined>): string {
  return sections
    .filter((section): section is string => Boolean(section))
    .map(section => section.trim())
    .join('\n\n');
}

export const BOOTSTRAP_ONLY_TOOL_NAMES = [
  'get_project_rules',
  'get_project_context',
  'list_tools',
  'list_skills',
] as const;

export type BootstrapOnlyToolName = typeof BOOTSTRAP_ONLY_TOOL_NAMES[number];

export function isBootstrapOnlyToolName(name: string): name is BootstrapOnlyToolName {
  return (BOOTSTRAP_ONLY_TOOL_NAMES as readonly string[]).includes(name);
}

function normalizePromptSiteId(siteId: string | null | undefined): string {
  return String(siteId ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/**
 * 工具执行请求载荷
 * 用于 Browser -> Extension -> Gateway 的链路
 */
export interface ToolExecutionPayload {
  name: string;
  arguments?: Record<string, unknown>;
  purpose?: string;
}

/**
 * Bridge -> Extension -> Gateway 的内部工具执行载荷。
 * internal_call_id 由 bridge 生成，只用于跨层 trace，不属于模型可见协议。
 */
export interface ToolExecutionTransportPayload extends ToolExecutionPayload {
  internal_call_id?: string;
}

/**
 * MCP 响应标准格式
 */
export interface McpResponse {
  mcp_action: 'result';
  name: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  system_note?: string;
}

/**
 * 会话连接信息
 */
export interface Session {
  port: number;
  token: string;
  showLog: boolean;
  autoSend: boolean;
  autoApproveTools: boolean;
  workspaceId: string;
  lastGatewayActivityAt?: number;
  siteId?: string;
  targetOrigin?: string;
  targetUrl?: string;
  allowedOrigins?: string[];
}
