<p align="center">
  <img src="doc/assets/webcode-logo.png" width="220" alt="webcode logo">
</p>

<h1 align="center">webcode</h1>

<p align="center">
  <strong>Local coding capabilities for web AI.</strong>
</p>

<p align="center">
  Through a VS Code extension and browser extension, webcode breaks the boundary between web AI and local projects, connecting ChatGPT, Gemini, DeepSeek, and other web AI products to local VS Code with file access, command execution, and MCP and Skills support.
</p>

<p align="center">
  English | <a href="README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/three-water666/webcode/actions/workflows/release.yml">
    <img alt="release workflow" src="https://img.shields.io/github/actions/workflow/status/three-water666/webcode/release.yml?label=release&color=22c55e">
  </a>
  <img alt="browser bridge version" src="https://img.shields.io/github/package-json/v/three-water666/webcode?filename=bridge-browser%2Fpackage.json&label=bridge&color=f97316">
  <a href="LICENSE">
    <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-16a34a">
  </a>
</p>

---

<p align="center">
  <img src="doc/assets/webcode-usage-screenshot.png" width="960" alt="webcode usage screenshot">
</p>

## Quick Start

### 1. Install the VS Code Extension

1. Open the VS Code Marketplace from the Extensions view.
2. Search for `webcode gateway`.
3. Install the extension.

### 2. Start the Gateway

1. Open a folder or workspace in VS Code.
2. Click `webcode: OFF` in the bottom-right status bar.
3. In the menu that opens, click `Start webcode`.
4. Wait for the status bar item to change to `webcode: <port>`.

When the status bar shows a port number, the local gateway is running.

### 3. Open a Supported AI Product

1. Choose the target site in the launch menu, such as `Open ChatGPT` or another supported entry.
2. webcode opens Microsoft Edge in [`Edge Isolated Keepalive`](doc/BROWSER_MODE_GUIDE_en.md) mode by default.
3. The isolated Edge profile auto-loads the bundled webcode bridge extension.
4. The bridge page completes the handshake with the local gateway automatically.
5. After the handshake succeeds, the browser redirects to the target AI site.

On first use, sign in to the target AI site once in the isolated Edge profile. When the bridge extension shows `ON`, the connection is ready to use.

### 4. Use It in Chat

1. Open a new chat on the target AI site.
2. Enter your actual task first, then add `/webcode` or `@webcode` at the end of the same message, or press Enter directly.
3. When webcode asks whether to add the initialization context, choose `Add` or press Enter.
4. webcode replaces the trigger word with the full initialization context. Review the message, then send it yourself.

If the initialization context exceeds the current AI site's input limit, webcode first attaches the full context as a txt file and keeps a short instruction in the input box.

For example:

- `Read src/utils.ts and write a unit test for it. /webcode`
- `List the files in the current workspace. @webcode`
- `Create project docs under the docs directory. /webcode`

## Built-in Tools

webcode includes built-in local tools such as `read_file`, `attach_file`, `write_file`, `edit_file`, `search_files`, `search_code`, `execute_command`, `run_in_terminal`, and `terminal_session` for text reads, image/PDF attachment delivery, file writes, code search, command execution, and terminal session management.

See the [built-in tools reference](doc/BUILTIN_TOOLS_en.md).

## MCP

Use `webcodeGateway.servers` when you want to attach third-party MCP servers for browser automation, GitHub, databases, or other external capabilities.

See the [MCP server configuration guide](doc/MCP_GUIDE_en.md).

## Skills

webcode can expose local Skills from the current VS Code workspace so the web AI can load project workflows, templates, domain notes, or script resources on demand.

See the [Skills guide](doc/SKILLS_GUIDE_en.md).

## Project Rules

During initialization, webcode reads project rule files from the root of the primary VS Code workspace and sends them with the initialization result:

- `USER_RULES.md`
- `AGENTS.md` or `CLAUDE.md`

If both `AGENTS.md` and `CLAUDE.md` exist, only `AGENTS.md` is sent. The browser extension no longer has a separate custom-instructions settings page.

## Additional AI Platform Support

webcode includes built-in support for common web AI products and can also attach new sites through VS Code configuration. Stable platforms can be added as built-in sites; experimental or private sites usually only need `webcodeGateway.aiSites`.

See the [site support guide](doc/PLATFORM_GUIDE_en.md).

## Build From Source

See the [build guide](doc/BUILD_GUIDE_en.md) for repository checkout, dependency installation, packaging scripts, artifacts, and local installation.

## FAQ

See the [FAQ guide](doc/FAQ_GUIDE_en.md) for first-launch setup, trigger-word issues, tool calls that executed but did not update the page, and tool-call history logs.

## Contributing

Issues and pull requests are welcome.

## License

[MIT License](LICENSE)
