import { PROTOCOL } from '@webcode/shared';

import { isRecord, type MessageRequest, type ToolExecutionPayload } from '../types';
import { formatGatewayToolResultData, parseGatewayToolResult } from '../modules/tool_result';
import { getErrorMessage } from './errors';
import { expireGatewaySession, recordGatewayActivity } from './session_health';
import { getActiveProtocolSessionResult, type ActiveProtocolSessionResult } from './sessions';

type InactiveProtocolSessionStatus = Exclude<ActiveProtocolSessionResult["status"], "active">;

export type CommandRiskLevel = "allowed" | "requires_confirmation" | "blocked";

export type ToolPreflightResponse = {
  success: boolean;
  error?: string;
  risk?: {
    level: CommandRiskLevel;
    reasons: string[];
  };
  challengeId?: string;
};

export async function executeTool(
  request: MessageRequest,
  tabId: number | null | undefined,
  senderUrl?: string
) {
  if (!tabId) {return { success: false, error: "No Session Tab" };}
  const sessionResult = await getActiveProtocolSessionResult(tabId, senderUrl);
  if (sessionResult.status !== "active") {
    return getInactiveSessionToolResponse(sessionResult.status);
  }
  const session = sessionResult.session;
  const { port, token } = session;
  const apiEndpoint = `http://127.0.0.1:${port}/v1/tools/call`;
  const payload = getToolPayload(request);
  if (!payload) {
    return { success: false, error: "Invalid tool payload." };
  }

  try {
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PROTOCOL.authHeaderName]: token,
      },
      body: JSON.stringify({
        name: payload.name,
        arguments: payload.arguments ?? {},
        request_id: payload.request_id,
        approval_token: request.approvalToken,
      }),
    });
    await recordGatewayActivity(tabId);
    if (response.ok) {
      return parseSuccessfulGatewayResponse(await response.json());
    }
    if (response.status === 403) {
      await expireGatewaySession(tabId, "invalid_token");
      return { success: false, error: "Session Expired/Invalid Token." };
    }
    const errorText = await readGatewayError(response);
    return {
      success: false,
      error: errorText || `${response.status} - ${response.statusText}`,
    };
  } catch (err: unknown) {
    await expireGatewaySession(tabId, "gateway_unavailable");
    return { success: false, error: `Connection Failed: ${getErrorMessage(err)}` };
  }
}

export async function preflightTool(
  request: MessageRequest,
  tabId: number | null | undefined,
  senderUrl?: string
): Promise<ToolPreflightResponse> {
  const connection = await getGatewayConnection(tabId, senderUrl);
  if (!connection.success) {return connection;}
  const payload = getToolPayload(request);
  if (!payload) {return { success: false, error: "Invalid tool payload." };}

  try {
    const response = await fetch(`${connection.endpoint}/v1/tools/preflight`, {
      method: "POST",
      headers: gatewayHeaders(connection.token),
      body: JSON.stringify({
        name: payload.name,
        arguments: payload.arguments ?? {},
        request_id: payload.request_id,
      }),
    });
    await recordGatewayActivity(connection.tabId);
    if (response.status === 403) {
      await expireGatewaySession(connection.tabId, "invalid_token");
      return { success: false, error: "Session Expired/Invalid Token." };
    }
    if (!response.ok) {
      return { success: false, error: await readGatewayError(response) };
    }

    const result: unknown = await response.json();
    if (!isRecord(result) || !isCommandRisk(result.risk)) {
      return { success: false, error: "Invalid command preflight response." };
    }
    const challenge = isRecord(result.challenge) && typeof result.challenge.id === "string"
      ? result.challenge.id
      : undefined;
    return {
      success: true,
      risk: result.risk,
      challengeId: challenge,
    };
  } catch (error: unknown) {
    await expireGatewaySession(connection.tabId, "gateway_unavailable");
    return { success: false, error: `Connection Failed: ${getErrorMessage(error)}` };
  }
}

export async function approveTool(
  request: MessageRequest,
  tabId: number | null | undefined,
  senderUrl?: string
): Promise<{ success: boolean; approvalToken?: string; error?: string }> {
  const connection = await getGatewayConnection(tabId, senderUrl);
  if (!connection.success) {return connection;}
  if (!request.challengeId) {
    return { success: false, error: "Missing command approval challenge." };
  }

  try {
    const response = await fetch(`${connection.endpoint}/v1/tools/approve`, {
      method: "POST",
      headers: gatewayHeaders(connection.token),
      body: JSON.stringify({ challenge_id: request.challengeId }),
    });
    await recordGatewayActivity(connection.tabId);
    if (response.status === 403) {
      await expireGatewaySession(connection.tabId, "invalid_token");
      return { success: false, error: "Session Expired/Invalid Token." };
    }
    if (!response.ok) {
      return { success: false, error: await readGatewayError(response) };
    }

    const result: unknown = await response.json();
    if (!isRecord(result) || typeof result.approval_token !== "string") {
      return { success: false, error: "Invalid command approval response." };
    }
    return { success: true, approvalToken: result.approval_token };
  } catch (error: unknown) {
    await expireGatewaySession(connection.tabId, "gateway_unavailable");
    return { success: false, error: `Connection Failed: ${getErrorMessage(error)}` };
  }
}

function getInactiveSessionToolResponse(status: InactiveProtocolSessionStatus): { success: false; error: string } {
  if (status === "suspended") {
    return {
      success: false,
      error: "Session suspended for this page. Return to the connected site to continue.",
    };
  }

  if (status === "invalid") {
    return {
      success: false,
      error: "Session data is incomplete. Reconnect from VS Code to continue.",
    };
  }

  return {
    success: false,
    error: "No active session for this tab. Connect from VS Code to continue.",
  };
}

type GatewayConnectionResult = {
  success: true;
  endpoint: string;
  tabId: number;
  token: string;
} | {
  success: false;
  error: string;
};

async function getGatewayConnection(
  tabId: number | null | undefined,
  senderUrl?: string
): Promise<GatewayConnectionResult> {
  if (!tabId) {return { success: false, error: "No Session Tab" };}
  const sessionResult = await getActiveProtocolSessionResult(tabId, senderUrl);
  if (sessionResult.status !== "active") {
    return getInactiveSessionToolResponse(sessionResult.status);
  }
  return {
    success: true,
    endpoint: `http://127.0.0.1:${sessionResult.session.port}`,
    tabId,
    token: sessionResult.session.token,
  };
}

function gatewayHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [PROTOCOL.authHeaderName]: token,
  };
}

function isCommandRisk(value: unknown): value is NonNullable<ToolPreflightResponse["risk"]> {
  if (!isRecord(value) || !Array.isArray(value.reasons)) {return false;}
  return (value.level === "allowed" || value.level === "requires_confirmation" || value.level === "blocked")
    && value.reasons.every((reason) => typeof reason === "string");
}

function getToolPayload(request: MessageRequest): ToolExecutionPayload | null {
  return request.payload && typeof request.payload.name === "string" ? request.payload : null;
}

function parseSuccessfulGatewayResponse(result: unknown) {
  const toolResult = parseGatewayToolResult(result);
  if (isRecord(result) && result.isError === true) {
    return {
      success: false,
      error: toolResult.text || "Tool execution failed.",
    };
  }
  if (toolResult.attachmentError) {
    return {
      success: false,
      error: toolResult.attachmentError,
    };
  }
  return { success: true, data: formatGatewayToolResultData(toolResult) };
}

async function readGatewayError(response: Response): Promise<string> {
  try {
    const resJson: unknown = await response.json();
    if (isRecord(resJson) && Array.isArray(resJson.content)) {
      return parseGatewayToolResult(resJson).text;
    }
    if (isRecord(resJson) && typeof resJson.error === "string") {
      return resJson.error;
    }
    return stringifyUnknown(resJson);
  } catch {
    return `${response.status} - ${response.statusText}`;
  }
}

function stringifyUnknown(value: unknown): string {
  const json = JSON.stringify(value);
  return typeof json === "string" ? json : String(value);
}
