import {
  BRANDING,
  PROTOCOL,
  type McpResponse,
  type ToolProtocolFormat,
} from "@webcode/shared";

export function formatToolResultCodeBlock(
  response: McpResponse,
  toolProtocol: ToolProtocolFormat
): string {
  if (toolProtocol === "json") {
    return `\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``;
  }

  const contentTag = response.status === "error" ? "error" : "output";
  const content = response.status === "error" ? response.error ?? "" : response.output ?? "";
  const systemNote = response.system_note
    ? `\n  <system_note><![CDATA[${escapeCdata(response.system_note)}]]></system_note>`
    : "";

  return [
    "```xml",
    "<tool_result>",
    `  <request_id>${escapeXmlText(response.request_id)}</request_id>`,
    `  <status>${response.status}</status>`,
    `  <${contentTag}><![CDATA[${escapeCdata(content)}]]></${contentTag}>${systemNote}`,
    "</tool_result>",
    "```",
  ].join("\n");
}

export function buildToolCallReminder(
  toolProtocol: ToolProtocolFormat,
  language: "zh" | "en"
): string {
  if (toolProtocol === "json") {
    return language === "zh"
      ? "[系统强制要求] 本页面只扫描带 `json` 标识的 Markdown 围栏代码块。禁止输出行内或裸 JSON；每个代码块只放一个调用，并为每次调用使用新的 request_id。"
      : "[System requirement] This page scans only Markdown fenced code blocks marked `json`. Never emit inline or raw JSON. Put one call in each block and use a new request_id every time.";
  }

  return language === "zh"
    ? [
      "[系统强制要求] 本页面只扫描带 `xml` 标识的 Markdown 围栏代码块。裸 `<tool_call>` 永远不会执行。",
      "每次工具调用的最终输出必须从 ` ```xml ` 开始、以 ` ``` ` 结束，块内只放一个 `<tool_call>`。",
      "`arguments` 使用纯 XML 子元素，并为每次调用使用新的 `request_id`。输出前必须检查围栏是否存在。",
    ].join("")
    : [
      "[System requirement] This page scans only Markdown fenced code blocks marked `xml`. A raw `<tool_call>` never executes. ",
      "Every final tool call must start with ` ```xml ` and end with ` ``` `, with exactly one `<tool_call>` inside. ",
      "Use pure XML children in `arguments`, a new `request_id`, and verify the fence before responding.",
    ].join("");
}

export function buildFinalToolCallContract(
  toolProtocol: ToolProtocolFormat,
  language: "zh" | "en"
): string {
  if (toolProtocol === "json") {
    const heading = language === "zh" ? "# 最终工具调用契约（必须遵守）" : "# Final Tool Call Contract (Required)";
    return `${heading}
\`\`\`json
{
  "mcp_action": "call",
  "name": "tool_name",
  "purpose": "brief reason",
  "arguments": {},
  "request_id": "turn_unique_step_1"
}
\`\`\``;
  }

  const heading = language === "zh" ? "# 最终工具调用契约（必须遵守）" : "# Final Tool Call Contract (Required)";
  const instruction = language === "zh"
    ? "Available Tools 中的 JSON Schema 只用于描述参数，不是调用格式。复制下面的 XML 结构。裸 XML 不会执行。工具名只能是 `<name>` 的文本，不能作为 XML 元素名。参数只能放在 `<arguments>` 内。"
    : "JSON Schema in Available Tools describes parameters only; it is not a call format. Copy this XML structure. Raw XML never executes. The tool name must be text inside `<name>`, never an XML element name. Put parameters only inside `<arguments>`.";
  return `${heading}
${instruction}
\`\`\`xml
<tool_call>
  <name>tool_name</name>
  <purpose>brief reason</purpose>
  <arguments>
    <schema_property>value</schema_property>
  </arguments>
  <request_id>turn_unique_step_1</request_id>
</tool_call>
\`\`\``;
}

export function buildProtocolErrorHint(
  toolProtocol: ToolProtocolFormat,
  language: "zh" | "en"
): string {
  if (toolProtocol === "json") {
    return `Standard tool format:
\`\`\`json
{
  "mcp_action": "call",
  "name": "tool_name",
  "purpose": "Brief justification for this action",
  "arguments": { "key": "value" },
  "request_id": "turn_unique_step_1"
}
\`\`\``;
  }

  const purpose = language === "zh" ? "执行此操作的简要原因" : "Brief justification for this action";
  return `Standard tool format:
\`\`\`xml
<tool_call>
  <name>tool_name</name>
  <purpose>${purpose}</purpose>
  <arguments>
    <key>value</key>
  </arguments>
  <request_id>turn_unique_step_1</request_id>
</tool_call>
\`\`\``;
}

export function buildInitToolCallPrompt(
  toolProtocol: ToolProtocolFormat,
  language: "zh" | "en"
): string {
  if (toolProtocol === "json") {
    return "";
  }

  const intro = language === "zh"
    ? `本次会话已挂载 ${BRANDING.productName}。请只输出以下 XML 初始化调用，不要输出其他内容。`
    : `${BRANDING.productName} is attached. Output only the following XML initialization call.`;
  const purpose = language === "zh"
    ? `为本次会话初始化 ${BRANDING.productName}`
    : `Initialize ${BRANDING.productName} for this conversation`;

  return `${intro}

\`\`\`xml
<tool_call>
  <name>${PROTOCOL.initToolName}</name>
  <purpose>${purpose}</purpose>
  <arguments />
  <request_id>init_unique_1</request_id>
</tool_call>
\`\`\``;
}

function escapeCdata(value: string): string {
  return value.replaceAll("]]>", "]]]]><![CDATA[>");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
