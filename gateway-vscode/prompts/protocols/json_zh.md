# 工具调用格式：JSON

本次会话只使用 JSON 工具协议。每个工具调用必须独占一个带 `json` 标识的围栏代码块，块内只能有一个对象。普通文本、行内 JSON、没有围栏的对象、调用数组和其他格式都不是工具调用，不会执行。

```json
{
  "mcp_action": "call",
  "name": "tool_name",
  "purpose": "执行此操作的简要原因",
  "arguments": {
    "key": "value"
  },
  "request_id": "turn_unique_step_1"
}
```

规则：

1. 顶层字段只能包含 `mcp_action`、`name`、`purpose`、`arguments` 和 `request_id`。
2. `mcp_action` 必须是 `"call"`，`name`、`purpose` 和 `request_id` 必填。
3. `arguments` 必须是严格匹配所选工具 `inputSchema` 的 JSON 对象；没有入参时使用 `{}`。
4. 每次调用使用新的 `request_id`，工具 `name` 必须与 Available Tools 完全一致。
5. 多个相互独立的调用必须输出为多个独立的 `json` 围栏代码块。

成功结果使用同一协议返回：

```json
{
  "mcp_action": "result",
  "request_id": "turn_unique_step_1",
  "status": "success",
  "output": "工具输出"
}
```

失败结果使用 `"status": "error"` 和 `"error"` 字段。应根据错误修正调用，不要编造成功。如果前一次调用没有对应结果，重试前先确认是否执行，并使用新的 `request_id`。
