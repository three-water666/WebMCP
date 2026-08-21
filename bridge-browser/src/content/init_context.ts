import { BRANDING, joinPromptSections, PROTOCOL, type ToolProtocolFormat } from "@webcode/shared";
import { i18n } from "../modules/i18n";
import { Logger } from "../modules/logger";
import { buildFinalToolCallContract } from "../modules/toolProtocolFormatting";
import { readPlatformPromptFromStorage } from "./prompt_resources";

interface ToolExecutionResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

interface WebcodeInitPromptOptions {
  includeInitToolResultHeader?: boolean;
  siteId?: string | null;
  toolProtocol?: ToolProtocolFormat;
}

export async function buildWebcodeInitPrompt(options: WebcodeInitPromptOptions = {}): Promise<string> {
  let finalPrompt = options.includeInitToolResultHeader === false
    ? ""
    : buildInitToolResultHeader();
  finalPrompt += await buildBasePrompt(options.siteId, options.toolProtocol ?? "json");

  Logger.log(`Initializing ${BRANDING.productName} with prompt, project rules, project context, tool list, and skill list`, "action");

  try {
    const projectRules = (await executeInitToolCall("get_project_rules")).trim();
    if (projectRules) {
      finalPrompt += `\n\n${projectRules}`;
    }
  } catch (error) {
    Logger.log(`Project rules fetch failed: ${getErrorMessage(error)}`, "error");
  }

  try {
    const projectContext = (await executeInitToolCall("get_project_context")).trim();
    if (projectContext) {
      finalPrompt += `\n\n${projectContext}`;
    }
  } catch (error) {
    Logger.log(`Project context fetch failed: ${getErrorMessage(error)}`, "error");
  }

  try {
    const [toolsResult, skillsResult] = await Promise.all([
      executeInitToolCall("list_tools"),
      executeInitToolCall("list_skills"),
    ]);

    const toolProtocol = options.toolProtocol ?? "json";
    finalPrompt += buildJsonResourceSection(`${BRANDING.productName} Available Tools`, toolsResult);
    finalPrompt += buildJsonResourceSection(`${BRANDING.productName} Available Skills`, skillsResult);
    finalPrompt += `\n\n${buildFinalToolCallContract(toolProtocol, i18n.lang)}`;
  } catch (error) {
    Logger.log(`Initialization data fetch failed: ${getErrorMessage(error)}`, "error");
    finalPrompt += `\n\n# Initialization Note\nFailed to fetch the tool or skill list. Re-run \`${PROTOCOL.initToolName}\` if needed.`;
  }

  return finalPrompt;
}

async function buildBasePrompt(
  siteId: string | null | undefined,
  toolProtocol: ToolProtocolFormat
): Promise<string> {
  const platformPrompt = await readPlatformPromptFromStorage(siteId);
  const protocolPrompt = toolProtocol === "xml"
    ? i18n.resources.protocolXml
    : i18n.resources.protocolJson;

  return joinPromptSections(i18n.resources.prompt, protocolPrompt, platformPrompt);
}

function buildInitToolResultHeader(): string {
  return i18n.lang === "zh"
    ? `以下是 ${PROTOCOL.initToolName} 的返回结果，请不要再次发送 ${PROTOCOL.initToolName} 初始化命令。\n\n`
    : `The following is the result returned by ${PROTOCOL.initToolName}. Do not send the ${PROTOCOL.initToolName} initialization command again.\n\n`;
}

function executeInitToolCall(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "EXECUTE_TOOL",
        payload: { name, arguments: {} },
      },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const result = normalizeToolResponse(response);
        if (!result.success) {
          reject(new Error(result.error ?? `Failed to execute ${name}`));
          return;
        }

        resolve(formatToolOutput(result.data, getInitToolFallback(name)));
      }
    );
  });
}

function buildJsonResourceSection(title: string, serializedJson: string): string {
  return `\n\n# ${title} (Definitions Only)\n\`\`\`json\n${serializedJson.trim() || "[]"}\n\`\`\``;
}

function formatToolOutput(data: unknown, fallback: string): string {
  return stringifyToolData(data, fallback);
}

function getInitToolFallback(toolName: string): string {
  return toolName === "get_project_rules" || toolName === "get_project_context" ? "" : "[]";
}

function normalizeToolResponse(response: unknown): ToolExecutionResponse {
  if (!isRecord(response)) {
    return {
      success: false,
      error: "Tool execution failed.",
    };
  }

  return {
    success: response.success === true,
    error: typeof response.error === "string" ? response.error : undefined,
    data: response.data,
  };
}

function stringifyToolData(data: unknown, fallback: string): string {
  if (typeof data === "string") {return data;}
  if (data == null) {return fallback;}
  const json = JSON.stringify(data, null, 2);
  if (typeof json === "string") {return json;}
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return String(data);
  }
  return fallback;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
