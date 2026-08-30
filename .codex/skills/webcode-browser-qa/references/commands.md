# 交互式 QA 命令

语言：中文 | [English](commands_en.md)

## 生命周期

```text
pnpm qa:start
pnpm qa:start chatgpt
pnpm qa:start deepseek read-code-call-chain
pnpm qa:status <run>
pnpm qa:stop <run>
```

`qa:start` 会构建桥接和 VS Code 扩展，将确定性夹具复制到隔离工作区，启动 Extension Host
和 Gateway，打开已加载构建后桥接的持久化站点浏览器配置文件，在 Workbench 中打开源文件，
并为浏览器和 VS Code Workbench 附加 Playwright CLI 会话。可选的第二个参数用于选择
`evals/scenarios` 下的任意 `agent-eval` 场景；不提供时使用最小桥接夹具。
VS Code 用户数据和扩展都隔离在本次运行中。如果主机进程或已认证的控制通道消失，
但清单仍显示正在运行，`qa:status` 会报告 `degraded`。

省略站点 ID 时选择 `deepseek`。内置站点 ID 包括 `chatgpt`、`gemini`、`aistudio`、
`deepseek`、`glm`、`claude` 和 `qwen`。应遵从用户指定的站点。只有当隔离的
Extension Host 中提供了完整的 `webcodeGateway.aiSites` 配置后，才能使用自定义站点 ID；
不要暗示尚未配置的站点受到支持。

`qa:start` 会从已知的默认位置使用本地安装的浏览器和 VS Code 可执行文件。
如果找不到其中任何一个，请找到该程序，将 `WEBCODE_EVAL_BROWSER_PATH` 或
`WEBCODE_EVAL_VSCODE_PATH` 设置为它的完整路径，然后重试。除非用户明确希望下载固定的
测试运行时，否则不要设置 `WEBCODE_EVAL_VSCODE_PATH=download`；绝不能将下载 VS Code
作为隐式的后备方案。

测试其他内置平台时，使用对应的内置站点 ID。登录状态存储在已被忽略的
`evals/live-profiles/<site-id>/` 目录中。

## Playwright

目标参数之后的所有参数都是官方 Playwright CLI 参数：

```text
pnpm qa:pw <run> browser snapshot
pnpm qa:pw <run> browser click e12
pnpm qa:pw <run> browser fill e7 "message"
pnpm qa:pw <run> browser press Enter
pnpm qa:pw <run> browser screenshot --filename=after-send.png
pnpm qa:pw <run> browser console warning
pnpm qa:pw <run> browser requests
pnpm qa:pw <run> browser run-code --filename=probe.js

pnpm qa:pw <run> vscode snapshot
pnpm qa:pw <run> vscode click e8
pnpm qa:pw <run> vscode screenshot --filename=vscode-state.png
```

使用 `pnpm qa:ctl <run> popup-url` 读取 `popupUrl`，然后在浏览器会话中使用 `tab-new`
将其打开。与工具栏弹窗不同，以普通标签页打开的弹窗最初会把自身视为 Chrome 的活动标签页。
判断状态前，应先让扩展页面针对其存储的目标会话完成准备：

```text
pnpm qa:pw <run> browser tab-new <popup-url>
pnpm qa:pw <run> browser run-code --filename=scripts/qa-popup-ready.js
pnpm qa:pw <run> browser snapshot
```

该辅助脚本会保持 AI 目标处于活动状态，重新加载扩展页面，并同时返回目标详情和弹窗文本。
使用 `tab-list` 和 `tab-select` 在 AI 站点与弹窗之间切换。所有 `qa:pw` 命令都应依次运行，
包括针对不同目标的命令，因为它们共享同一个 CLI 守护进程。如果命名会话消失，`qa:pw`
会自动重新附加到本次运行的 CDP 端点。

## Extension Host 与 Gateway

```text
pnpm qa:ctl <run> status
pnpm qa:ctl <run> manifest
pnpm qa:ctl <run> task
pnpm qa:ctl <run> review
pnpm qa:ctl <run> trace 50
pnpm qa:ctl <run> vscode state
pnpm qa:ctl <run> vscode command <command-id> '["argument"]'
pnpm qa:ctl <run> vscode config get webcodeGateway.port
pnpm qa:ctl <run> vscode config set webcodeGateway.browser '"isolated-edge"'
pnpm qa:ctl <run> vscode open seed.txt 1 1
```

在 PowerShell 中，为 JSON 添加引号，确保它作为一个参数传给控制脚本。优先在隔离的
Extension Host 中读取配置和执行命令，不要修改个人 VS Code 状态。

`task` 返回复制到本次运行中的固定提示词。只向站点发送任务文本，不要暴露场景清单或评分器。
`review` 汇总工作区新增、修改和删除的内容以及工具事件时间线；判断前应检查改动后的文件内容
和可见对话。UI 调查完成且会话停止后，可以使用
`pnpm eval:scenarios grade <run-id>` 运行智能体评测评分器，作为可选证据。

## 产物

每次运行都会在 `evals/runs/<run-id>/` 下存储 `run.json`、`trace.jsonl`、进程日志、
Playwright 输出、截图、隔离工作区以及浏览器和 Extension Host 描述文件。
相对的 `screenshot --filename=...` 路径会自动放在本次运行的 `artifacts/browser/`
或 `artifacts/vscode/` 目录下。

如果启动失败，重试前检查 `logs/vscode.stderr.log`、`logs/vscode.stdout.log`、
`logs/browser.stderr.log` 和 `browser-host.json`。
