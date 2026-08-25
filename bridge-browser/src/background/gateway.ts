import { PROTOCOL } from '@webcode/shared';

import { isRecord, type MessageRequest, type ToolExecutionPayload } from '../types';
import { getErrorMessage } from './errors';
import { expireGatewaySession, recordGatewayActivity } from './session_health';
import { getActiveProtocolSessionResult, type ActiveProtocolSessionResult } from './sessions';

type InactiveProtocolSessionStatus = Exclude<ActiveProtocolSessionResult["status"], "active">;

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

function getToolPayload(request: MessageRequest): ToolExecutionPayload | null {
  return request.payload && typeof request.payload.name === "string" ? request.payload : null;
}

function parseSuccessfulGatewayResponse(result: unknown): { success: boolean; data?: string; error?: string } {
  const textContent = formatGatewayToolContent(result);
  if (isRecord(result) && result.isError === true) {
    return {
      success: false,
      error: textContent || "Tool execution failed.",
    };
  }
  return { success: true, data: textContent };
}

function formatGatewayToolContent(result: unknown): string {
  if (isRecord(result) && Array.isArray(result.content)) {
    return result.content
      .map(getGatewayTextContent)
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return stringifyUnknown(result);
}

async function readGatewayError(response: Response): Promise<string> {
  try {
    const resJson: unknown = await response.json();
    if (isRecord(resJson) && Array.isArray(resJson.content)) {
      return formatGatewayToolContent(resJson);
    }
    if (isRecord(resJson) && typeof resJson.error === "string") {
      return resJson.error;
    }
    return stringifyUnknown(resJson);
  } catch {
    return `${response.status} - ${response.statusText}`;
  }
}

function getGatewayTextContent(item: unknown): string {
  return isRecord(item) && typeof item.text === "string" ? item.text : "";
}

function stringifyUnknown(value: unknown): string {
  const json = JSON.stringify(value);
  return typeof json === "string" ? json : String(value);
}
