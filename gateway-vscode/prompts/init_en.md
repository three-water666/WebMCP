This conversation has {{PRODUCT_NAME}} attached, providing local file operation capabilities and some Skills.
Please output only the following initialization command to initialize {{PRODUCT_NAME}}, with no other content.
The initialization command must be placed inside a JSON code block. Do not use plain text or inline JSON.

Initialization command:
```json
{
  "mcp_action": "call",
  "name": "{{INIT_TOOL_NAME}}",
  "purpose": "Initialize {{PRODUCT_NAME}} for this conversation",
  "arguments": {},
  "request_id": "init_unique_1"
}
```
