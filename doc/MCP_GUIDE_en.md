# webcode MCP Server Configuration Guide

This guide explains how to configure third-party MCP servers in webcode, using `chrome-devtools-mcp` as an example.

webcode already provides built-in local tools for files, search, and command execution through the VS Code extension. You do not need to configure extra MCP servers for those built-in capabilities. `webcodeGateway.servers` is only for optional third-party MCP servers.

## Configuration Location

Open the workspace `settings.json` in VS Code:

1. Open the Command Palette
2. Search for `Preferences: Open Workspace Settings (JSON)`
3. Add or update `webcodeGateway.servers`

You can also put this setting in your user-level `settings.json`. If the config contains tokens, account data, or private service URLs, prefer user-level settings and do not commit them to the repository.

## Basic Format

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

Field reference:

- `server-id`
  - Custom server name
  - Used as the prefix for third-party MCP tool names
  - For example, if the server id is `chrome-devtools`, tools are exposed as `chrome-devtools:<toolName>`

- `type`
  - Supported values: `stdio`, `sse`, `http`
  - Defaults to `stdio` when omitted

- `command`
  - Startup command for a `stdio` server
  - On Windows, you can write `npx` or `npm`; webcode converts it to the matching `.cmd` command automatically

- `args`
  - Arguments passed to `command`
  - `.` and `${workspaceFolder}` are replaced with the primary VS Code workspace path

- `url`
  - Connection URL for `sse` or `http` servers

- `headers`
  - Request headers for `sse` or `http` servers

- `env`
  - Environment variables passed to the `stdio` server process

- `disabled`
  - Set to `true` to skip this server

## Example: chrome-devtools-mcp

The official MCP client example usually looks like this:

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

In webcode, write the equivalent config under the VS Code setting `webcodeGateway.servers`:

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

If you only need basic browser tasks, you can use slim/headless mode:

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

After saving the config, webcode gateway restarts automatically if it is already running and `webcodeGateway.servers` changed. You can also stop and start it manually from the VS Code status bar.

## Tool Name Rules

webcode prefixes third-party MCP tool names with the server id to avoid collisions with built-in tools.

Rules:

- Built-in local tools use bare names, such as `read_file`, `write_file`, and `execute_command`
- Third-party MCP tools use `server-id:toolName`
- Bare names belong only to built-in local tools and are not routed to third-party MCP servers

For example, with this config:

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

After initialization, tools in the `chrome-devtools` group appear in Available Tools as:

```text
chrome-devtools:<toolName>
```

When calling a third-party tool, use the full name shown in Available Tools. Example:

```json
{
  "mcp_action": "call",
  "name": "chrome-devtools:<toolName>",
  "purpose": "Use Chrome DevTools MCP for the browser task.",
  "arguments": {},
  "request_id": "turn_unique_step_1"
}
```

Do not call third-party tools with bare names like `<toolName>`. Bare names only look up webcode built-in tools.

## HTTP and SSE Servers

If a third-party MCP server is not started over stdio and already exposes an HTTP or SSE endpoint, configure it like this.

HTTP example:

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

SSE example:

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

## Built-In Capabilities That Do Not Need MCP Config

The following capabilities are built into webcode and do not require third-party MCP server configuration:

- `read_file`
- `attach_file`
- `write_file`
- `edit_file`
- `search_files`
- `search_code`
- `execute_command`
- `run_in_terminal`
- `terminal_session`

These legacy built-in server ids are ignored:

- `filesystem`
- `command`
- `builtin_filesystem`
- `builtin_command`

## Troubleshooting

### No tools appear after configuration

Check the webcode gateway logs in the VS Code Output panel. Common causes:

- `command` does not exist or cannot start
- `npx` failed to download dependencies
- `args` is not an array
- The HTTP/SSE `url` is not reachable
- The server started but did not return an MCP tool list

### A tool appears but calls fail

Make sure the call name exactly matches the name shown in Available Tools. Third-party MCP tools must include the server prefix, for example:

```text
chrome-devtools:<toolName>
```

### Temporarily disable a server

Set `disabled: true`:

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
