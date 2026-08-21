import { type ToolProtocolFormat } from "@webcode/shared";
import { type ToolExecutionPayload } from "../types";
import { parseModelJson } from "./jsonRepair";

export type ParsedToolCallPayload = ToolExecutionPayload & {
  mcp_action: "call";
  purpose: string;
};

const ALLOWED_TOP_LEVEL_KEYS = new Set(["mcp_action", "name", "purpose", "arguments", "request_id"]);
const ALLOWED_XML_ROOT_CHILDREN = new Set(["name", "purpose", "arguments", "request_id"]);
const JSON_TOOL_CALL_RE = /["'\u201C\u201D]?mcp_action["'\u201C\u201D]?\s*:\s*["'\u201C\u201D]?call["'\u201C\u201D]?/i;
const XML_TOOL_CALL_RE = /<tool_call(?=[\s>])/i;

export class ToolCallProtocolError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "ToolCallProtocolError";
    this.issues = issues;
  }
}

export function looksLikeToolCall(text: string, format?: ToolProtocolFormat): boolean {
  if (format === "json") {return JSON_TOOL_CALL_RE.test(text);}
  if (format === "xml") {return XML_TOOL_CALL_RE.test(text);}
  return JSON_TOOL_CALL_RE.test(text) || XML_TOOL_CALL_RE.test(text);
}

export function parseToolCall(
  text: string,
  format: ToolProtocolFormat = "json"
): ParsedToolCallPayload {
  const parsed = format === "xml" ? parseXmlToolCall(text) : parseJsonToolCall(text);
  const issues = validateToolCallEnvelope(parsed);
  if (issues.length > 0) {
    throw new ToolCallProtocolError(issues);
  }
  return parsed as ParsedToolCallPayload;
}

function parseJsonToolCall(text: string): unknown {
  try {
    return parseModelJson(text);
  } catch {
    throw new ToolCallProtocolError([
      "The tool call JSON could not be parsed. Return one complete fenced JSON tool-call block.",
    ]);
  }
}

function parseXmlToolCall(text: string): unknown {
  if (/<!DOCTYPE/i.test(text)) {
    throw new ToolCallProtocolError(["XML document types are not allowed in tool calls."]);
  }

  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  if (documentNode.querySelector("parsererror")) {
    throw new ToolCallProtocolError([
      "The tool call XML could not be parsed. Return one complete fenced XML document.",
    ]);
  }

  const root = documentNode.documentElement;
  if (root.localName !== "tool_call") {
    throw new ToolCallProtocolError(["The XML root element must be <tool_call>."]);
  }

  const rootChildren = getChildElements(root);
  const unexpectedElements = rootChildren
    .map((element) => element.localName)
    .filter((name) => !ALLOWED_XML_ROOT_CHILDREN.has(name));
  if (unexpectedElements.length > 0) {
    throw new ToolCallProtocolError([
      `Remove unexpected <tool_call> element(s): ${unexpectedElements.join(", ")}.`,
    ]);
  }

  const argumentsElement = getUniqueChild(root, "arguments");
  return {
    mcp_action: "call",
    name: readRequiredTextChild(root, "name"),
    purpose: readRequiredTextChild(root, "purpose"),
    arguments: argumentsElement ? parseXmlObject(argumentsElement) : undefined,
    request_id: readRequiredTextChild(root, "request_id"),
  };
}

function parseXmlObject(element: Element): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const child of getChildElements(element)) {
    const name = child.localName;
    if (Object.hasOwn(result, name)) {
      throw new ToolCallProtocolError([
        `XML object field <${name}> appears more than once. Use an <item> array container instead.`,
      ]);
    }
    result[name] = parseXmlValue(child);
  }
  return result;
}

function parseXmlValue(element: Element): unknown {
  const declaredType = element.getAttribute("type")?.trim().toLowerCase();
  const children = getChildElements(element);

  if (declaredType === "array" || (
    children.length > 0 && children.every((child) => child.localName === "item")
  )) {
    return parseXmlArray(element, children);
  }
  if (declaredType === "object") {
    return parseXmlObject(element);
  }
  if (children.length > 0) {return parseXmlObject(element);}

  return parseXmlScalar(element, declaredType);
}

function parseXmlScalar(element: Element, declaredType: string | undefined): unknown {
  const text = readXmlScalarText(element, declaredType === "string");
  if (declaredType === "string") {return text;}
  if (declaredType === "number" || declaredType === "integer") {
    const parsedNumber = Number(text.trim());
    return Number.isFinite(parsedNumber) ? parsedNumber : text;
  }
  if (declaredType === "boolean") {return text.trim().toLowerCase() === "true";}
  if (declaredType === "null") {return null;}
  return inferXmlScalar(text);
}

function parseXmlArray(element: Element, children: Element[]): unknown[] {
  if (children.some((child) => child.localName !== "item")) {
    throw new ToolCallProtocolError([
      `XML array <${element.localName}> may only contain <item> children.`,
    ]);
  }
  return children.map((child) => parseXmlValue(child));
}

function inferXmlScalar(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true") {return true;}
  if (trimmed === "false") {return false;}
  if (trimmed === "null") {return null;}
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return text;
}

function readXmlScalarText(element: Element, preserveWhitespace = false): string {
  const hasCdata = Array.from(element.childNodes).some((node) => node.nodeType === Node.CDATA_SECTION_NODE);
  const text = element.textContent ?? "";
  return hasCdata || preserveWhitespace ? text : text.trim();
}

function readRequiredTextChild(parent: Element, childName: string): string | undefined {
  const child = getUniqueChild(parent, childName);
  if (!child) {return undefined;}
  if (getChildElements(child).length > 0) {
    throw new ToolCallProtocolError([`XML element <${childName}> must contain text only.`]);
  }
  return (child.textContent ?? "").trim();
}

function getUniqueChild(parent: Element, childName: string): Element | null {
  const matches = getChildElements(parent).filter((child) => child.localName === childName);
  if (matches.length > 1) {
    throw new ToolCallProtocolError([`XML element <${childName}> may appear only once.`]);
  }
  return matches[0] ?? null;
}

function getChildElements(element: Element): Element[] {
  return Array.from(element.children);
}

function validateToolCallEnvelope(value: unknown): string[] {
  if (!isJsonObject(value)) {
    return ["The top-level tool call must be an object."];
  }

  const issues: string[] = [];
  const unexpectedKeys = Object.keys(value).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));
  if (unexpectedKeys.length > 0) {
    issues.push(`Remove unexpected top-level field(s): ${unexpectedKeys.map((key) => `"${key}"`).join(", ")}.`);
  }
  if (value.mcp_action !== "call") {
    issues.push('Field "mcp_action" must be exactly the string "call".');
  }
  if (!isNonEmptyString(value.name)) {
    issues.push('Field "name" must be a non-empty string tool name.');
  }
  if (!isNonEmptyString(value.purpose)) {
    issues.push('Field "purpose" must be a non-empty string explaining why the tool is needed.');
  }
  if (!isNonEmptyString(value.request_id)) {
    issues.push('Field "request_id" must be a new non-empty string.');
  }
  if (!isJsonObject(value.arguments)) {
    issues.push('Field "arguments" must be an object. Use an empty object when the tool has no arguments.');
  }
  return issues;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
