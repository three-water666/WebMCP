# webcode MCP 服务配置指南

本文说明如何在 webcode 中配置第三方 MCP server，例如 `chrome-devtools-mcp`。

webcode 自带的文件、搜索、命令执行等能力已经由 VS Code 扩展内置实现，不需要再额外配置 MCP server。`webcodeGateway.servers` 只用于接入可选的第三方 MCP server。

## 配置入口

在 VS Code 中打开当前工作区的 `settings.json`：

1. 打开命令面板
2. 搜索 `Preferences: Open Workspace Settings (JSON)`
3. 添加或修改 `webcodeGateway.servers`

也可以写在用户级 `settings.json` 中。涉及 token、账号或私有服务地址时，优先使用用户级配置，不要提交到仓库。

## 基本格式

```json
{
  "webcodeGateway.servers": {
    "server-id": {
      "type": "stdio",
      "command": "command-name",
      "args": ["arg1", "arg2"],
      "env": {
        "ENV_NAME": "value"
      }
    }
  }
}
```

字段说明：

- `server-id`
  - 自定义 server 名称
  - 会成为第三方 MCP 工具名前缀
  - 例如 server id 是 `chrome-devtools`，工具名会暴露为 `chrome-devtools:<toolName>`

- `type`
  - 可选值：`stdio`、`sse`、`http`
  - 不写时默认按 `stdio` 处理

- `command`
  - `stdio` server 的启动命令
  - Windows 下写 `npx` 或 `npm` 即可，webcode 会自动转换为对应的 `.cmd`

- `args`
  - 传给 `command` 的参数数组
  - `.` 和 `${workspaceFolder}` 会被替换为当前 VS Code 主工作区路径

- `url`
  - `sse` 或 `http` server 的连接地址

- `headers`
  - `sse` 或 `http` 请求头

- `env`
  - 传给 `stdio` server 进程的环境变量

- `disabled`
  - 设为 `true` 时跳过该 server

## 示例：chrome-devtools-mcp

官方 MCP client 示例通常使用：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

在 webcode 中，对应写成 VS Code 设置项 `webcodeGateway.servers`：

```json
{
  "webcodeGateway.servers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

如果只需要基础浏览器任务，可以使用 slim/headless 模式：

```json
{
  "webcodeGateway.servers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--slim", "--headless"]
    }
  }
}
```

保存配置后，如果 webcode gateway 已经在运行，它会因 `webcodeGateway.servers` 配置变化自动重启。也可以从 VS Code 状态栏手动停止再启动。

## 工具名规则

webcode 会把第三方 MCP 工具名加上 server 前缀，避免和内置工具重名。

规则：

- 内置本地工具使用裸名，例如 `read_file`、`write_file`、`execute_command`
- 第三方 MCP 工具使用 `server-id:toolName`
- 裸名只属于内置本地工具，不会路由到第三方 MCP server

例如配置了：

```json
{
  "webcodeGateway.servers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

初始化后，Available Tools 中 `chrome-devtools` 分组里的工具会显示为：

```text
chrome-devtools:<toolName>
```

调用第三方工具时，必须使用 Available Tools 里展示的完整名称。例如：

```json
{
  "mcp_action": "call",
  "name": "chrome-devtools:<toolName>",
  "purpose": "Use Chrome DevTools MCP for the browser task.",
  "arguments": {}
}
```

不要把第三方工具写成裸名 `<toolName>`。裸名只会查找 webcode 内置工具。

## HTTP 和 SSE server

如果第三方 MCP server 不是通过 stdio 启动，而是已经提供 HTTP 或 SSE 端点，可以这样配置。

HTTP 示例：

```json
{
  "webcodeGateway.servers": {
    "my-http-server": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

SSE 示例：

```json
{
  "webcodeGateway.servers": {
    "my-sse-server": {
      "type": "sse",
      "url": "http://127.0.0.1:3000/sse"
    }
  }
}
```

## 不需要再配置的内置能力

以下能力由 webcode 内置提供，不需要配置第三方 MCP server：

- `read_file`
- `attach_file`
- `write_file`
- `edit_file`
- `search_files`
- `search_code`
- `execute_command`
- `run_in_terminal`
- `terminal_session`

旧配置中的这些 server id 会被忽略：

- `filesystem`
- `command`
- `builtin_filesystem`
- `builtin_command`

## 常见问题

### 配置后没有工具

先检查 VS Code 输出面板中的 webcode gateway 日志。常见原因：

- `command` 不存在或无法启动
- `npx` 下载依赖失败
- `args` 写法不是数组
- HTTP/SSE 的 `url` 不可访问
- server 启动后没有返回 MCP tool list

### 工具显示了但调用失败

确认调用名和 Available Tools 里的名称完全一致。第三方 MCP 工具必须包含 server 前缀，例如：

```text
chrome-devtools:<toolName>
```

### 想临时停用某个 server

设置 `disabled: true`：

```json
{
  "webcodeGateway.servers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"],
      "disabled": true
    }
  }
}
```
