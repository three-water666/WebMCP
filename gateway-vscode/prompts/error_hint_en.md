❌ **Format Error Warning**

Your model response content does not meet the requirements. Top-level fields may only be `mcp_action`, `name`, `purpose`, and `arguments`. `name` and `purpose` are required. If the selected tool has inputs, `arguments` must exactly match that tool's `inputSchema`.

```json
{
  "mcp_action": "call",
  "name": "tool_name",
  "purpose": "justification",
  "arguments": {
    "key": "value"
  }
}
```

Please regenerate the instruction according to the correct format above.
