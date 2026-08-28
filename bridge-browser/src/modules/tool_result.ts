export const TOOL_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export interface ToolResultAttachment {
  data: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ToolResultAttachmentGroup {
  attachments: ToolResultAttachment[];
  outputIndex: number;
  requestId: string;
  toolName?: string;
}

export interface ToolResultDeliveryBatch {
  attachmentGroups: ToolResultAttachmentGroup[];
  output: string;
  outputParts: string[];
}

export interface ToolResultAttachmentFailure {
  outputIndex: number;
  reason: string;
  requestId: string;
}

export interface ToolResultData {
  attachments: ToolResultAttachment[];
  text: string;
}

const SUPPORTED_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function parseGatewayToolResult(result: unknown): ToolResultData {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return { attachments: [], text: stringifyUnknown(result) };
  }

  const attachments: ToolResultAttachment[] = [];
  const textParts: string[] = [];
  result.content.forEach((item) => {
    if (!isRecord(item)) {return;}
    if (item.type === "text" && typeof item.text === "string") {
      if (item.text.length > 0) {textParts.push(item.text);}
      return;
    }

    const attachment = parseContentAttachment(item, attachments.length + 1);
    if (attachment) {attachments.push(attachment);}
  });

  return {
    attachments,
    text: textParts.join("\n"),
  };
}

export function formatGatewayToolResultData(result: ToolResultData): string | ToolResultData {
  return result.attachments.length > 0 ? result : result.text;
}

export function normalizeToolResultData(data: unknown, fallback: string): ToolResultData {
  if (typeof data === "string") {
    return { attachments: [], text: data };
  }
  if (isRecord(data) && typeof data.text === "string" && Array.isArray(data.attachments)) {
    return {
      attachments: data.attachments
        .map((attachment) => normalizeTransportAttachment(attachment))
        .filter((attachment): attachment is ToolResultAttachment => Boolean(attachment)),
      text: data.text,
    };
  }
  return {
    attachments: [],
    text: stringifyToolData(data, fallback),
  };
}

export function applyAttachmentDeliveryFailures(
  outputParts: readonly string[],
  failures: readonly ToolResultAttachmentFailure[]
): string[] {
  const failuresByOutput = new Map(
    failures.map((failure) => [failure.outputIndex, failure] as const)
  );
  return outputParts.map((output, outputIndex) => {
    const failure = failuresByOutput.get(outputIndex);
    return failure
      ? replaceMcpResultWithAttachmentError(output, failure.requestId, failure.reason)
      : output;
  });
}

function replaceMcpResultWithAttachmentError(
  output: string,
  requestId: string,
  reason: string
): string {
  const match = /^```json\r?\n([\s\S]*)\r?\n```$/.exec(output);
  if (match) {
    try {
      const response = JSON.parse(match[1]) as unknown;
      if (isRecord(response) &&
        response.mcp_action === "result" &&
        response.request_id === requestId) {
        const errorResponse: Record<string, unknown> = {
          ...response,
          status: "error",
        };
        delete errorResponse.output;
        errorResponse.error = reason;
        return formatJsonCodeBlock(errorResponse);
      }
    } catch {
      // The fallback below still produces a valid MCP result for the associated request.
    }
  }

  return formatJsonCodeBlock({
    mcp_action: "result",
    request_id: requestId,
    status: "error",
    error: reason,
  });
}

function formatJsonCodeBlock(value: Record<string, unknown>): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function parseContentAttachment(
  item: Record<string, unknown>,
  attachmentNumber: number
): ToolResultAttachment | null {
  if (item.type === "image") {
    return createAttachment({
      data: item.data,
      mimeType: item.mimeType,
      name: undefined,
    }, attachmentNumber);
  }
  if (item.type !== "resource" || !isRecord(item.resource)) {
    return null;
  }

  const resource = item.resource;
  const metaFileName = isRecord(resource._meta) && typeof resource._meta.fileName === "string"
    ? resource._meta.fileName
    : undefined;
  return createAttachment({
    data: resource.blob,
    mimeType: resource.mimeType,
    name: metaFileName ?? getResourceFileName(resource.uri),
  }, attachmentNumber);
}

function normalizeTransportAttachment(value: unknown): ToolResultAttachment | null {
  if (!isRecord(value)) {return null;}
  return createAttachment({
    data: value.data,
    mimeType: value.mimeType,
    name: value.name,
  }, 1);
}

function createAttachment(
  candidate: { data: unknown; mimeType: unknown; name: unknown },
  attachmentNumber: number
): ToolResultAttachment | null {
  if (typeof candidate.data !== "string" || typeof candidate.mimeType !== "string") {
    return null;
  }

  const mimeType = candidate.mimeType.trim().toLowerCase();
  const extension = SUPPORTED_MIME_EXTENSIONS[mimeType];
  if (!extension) {return null;}

  const normalizedBase64 = normalizeBase64(candidate.data);
  if (!normalizedBase64) {return null;}
  const size = getBase64DecodedSize(normalizedBase64);
  if (size <= 0 || size > TOOL_ATTACHMENT_MAX_BYTES) {return null;}

  const providedName = typeof candidate.name === "string" ? sanitizeFileName(candidate.name) : "";
  return {
    data: normalizedBase64,
    mimeType,
    name: providedName || `attachment-${attachmentNumber}${extension}`,
    size,
  };
}

function getResourceFileName(uri: unknown): string | undefined {
  if (typeof uri !== "string") {return undefined;}
  try {
    const parsed = new URL(uri);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeFileName(value: string): string {
  const leafName = value.replace(/\0/g, "").split(/[\\/]/).at(-1)?.trim() ?? "";
  return leafName.slice(0, 255);
}

function normalizeBase64(value: string): string | null {
  const compact = value.trim();
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    return null;
  }
  return compact.padEnd(compact.length + ((4 - compact.length % 4) % 4), "=");
}

function getBase64DecodedSize(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length * 3 / 4 - padding;
}

function stringifyToolData(data: unknown, fallback: string): string {
  if (data == null) {return fallback;}
  const json = JSON.stringify(data, null, 2);
  if (typeof json === "string") {return json;}
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return String(data);
  }
  return fallback;
}

function stringifyUnknown(value: unknown): string {
  const json = JSON.stringify(value);
  return typeof json === "string" ? json : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
