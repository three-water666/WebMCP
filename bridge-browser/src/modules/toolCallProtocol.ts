import { parseModelJson } from "./jsonRepair";
import { type ToolExecutionPayload } from "../types";

export type ParsedToolCallPayload = ToolExecutionPayload & {
  mcp_action: "call";
  purpose: string;
};

// request_id remains accepted only so conversations initialized by an older
// webcode version can finish without a protocol error. It is discarded below.
const ALLOWED_TOP_LEVEL_KEYS = new Set(["mcp_action", "name", "purpose", "arguments", "request_id"]);
const TOOL_CALL_RE = /["'\u201C\u201D]?mcp_action["'\u201C\u201D]?\s*:\s*["'\u201C\u201D]?call["'\u201C\u201D]?/i;

export class ToolCallProtocolError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "ToolCallProtocolError";
    this.issues = issues;
  }
}

export function looksLikeToolCall(text: string): boolean {
  return TOOL_CALL_RE.test(text);
}

export function parseToolCall(text: string): ParsedToolCallPayload {
  let parsed: unknown;
  try {
    parsed = parseModelJson(text);
  } catch {
    throw new ToolCallProtocolError([
      "The tool call JSON could not be parsed or repaired. Return a single JSON object tool call.",
    ]);
  }

  const issues = validateToolCallEnvelope(parsed);
  if (issues.length > 0) {
    throw new ToolCallProtocolError(issues);
  }

  const record = parsed as Record<string, unknown>;
  return {
    arguments: record.arguments as Record<string, unknown> | undefined,
    mcp_action: "call",
    name: record.name as string,
    purpose: record.purpose as string,
  };
}

function validateToolCallEnvelope(value: unknown): string[] {
  if (!isJsonObject(value)) {
    return ["The top-level tool call must be a JSON object."];
  }

  const issues: string[] = [];
  const record = value;
  const unexpectedKeys = Object.keys(record).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));

  if (unexpectedKeys.length > 0) {
    issues.push(`Remove unexpected top-level field(s): ${unexpectedKeys.map((key) => `"${key}"`).join(", ")}.`);
  }

  if (record.mcp_action !== "call") {
    issues.push('Field "mcp_action" must be exactly the string "call".');
  }
  if (!isNonEmptyString(record.name)) {
    issues.push('Field "name" must be a non-empty string tool name.');
  }
  if (!isNonEmptyString(record.purpose)) {
    issues.push('Field "purpose" must be a non-empty string explaining why the tool is needed.');
  }

  const args = record.arguments;
  if (args !== undefined && !isJsonObject(args)) {
    issues.push('Field "arguments" must be a JSON object when provided. Use {} when the tool has no arguments.');
  }

  return issues;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
