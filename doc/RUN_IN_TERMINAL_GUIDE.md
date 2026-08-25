# run_in_terminal 与 terminal_session 设计说明

本文说明 `run_in_terminal` 和 `terminal_session` 两个内置工具的目标、用户行为、实现设计和已知边界，方便开发者维护，也方便用户理解 AI 在 VS Code 终端中执行命令时发生了什么。

## 背景

早期 `run_in_terminal` 使用 VS Code `Pseudoterminal` 承载输出，但底层由扩展自己通过 Node `child_process.spawn` 启动命令。Windows 上固定走 Git Bash，并使用类似下面的方式执行：

```text
bash.exe -lc "<command>"
```

这种方式便于扩展采集 stdout、stderr 和退出码，但它并不等同于用户在 VS Code 集成终端里手动输入命令。典型差异包括：

- 命令结束后伪终端进程也会结束，VS Code 可能显示“终端进程已终止”。
- Windows 上只能使用 POSIX/bash 语法，无法使用用户常用的 PowerShell 或 pwsh。
- `terminal_session stop` 之前更接近强杀进程树并关闭终端，而不是用户按 `Ctrl+C`。

优化后的目标是让 `run_in_terminal` 更接近“AI 帮用户在 VS Code 真实集成终端里输入命令”。

## 工具定位

### execute_command

`execute_command` 用于后台执行短生命周期命令，并直接返回 stdout、stderr 和 exitCode。它支持用 workspace 相对 `path` 指定执行目录，默认 `.`；也可以用 `profile` 选择已发现的 Git Bash、PowerShell 或 POSIX shell。省略 `profile` 时保留原有 POSIX/Git Bash 行为。

适合：

- 构建
- 测试
- git 命令
- 包管理器脚本
- 不需要用户实时查看终端的短命令

### run_in_terminal

`run_in_terminal` 用于在可见 VS Code 终端中运行命令，并立即返回 `session_id`。它支持用 workspace 相对 `path` 指定执行目录，默认 `.`。它适合长时间运行、需要用户看见过程，或者可能需要交互的命令。

适合：

- `pnpm dev`
- watch 模式
- 本地开发服务器
- 用户希望看到输出过程的命令
- 需要在 Git Bash、PowerShell 或 pwsh 中按对应语法运行的命令

### terminal_session

`terminal_session` 管理由 `run_in_terminal` 创建的会话。它不启动新命令，只负责读取、列出、中断或关闭已有终端会话。

支持动作：

- `list`：列出会话状态。
- `read`：读取已采集的最近输出，可用 `delay_seconds` 等待一段时间后再读。
- `stop`：向终端发送 `Ctrl+C`，请求中断当前命令，保留终端窗口。
- `close`：关闭终端标签页。

### 执行目录参数

`execute_command` 和 `run_in_terminal` 使用 `path` 表示命令执行目录。`path` 必须是 workspace 相对目录，默认 `.`，不接受绝对路径、`~` home 路径或反斜杠。

`path` 由 webcode 在 shell 选择前解析，不是 shell 命令文本的一部分，因此所有 terminal profile 使用同一种格式。无论选择 `default`、`git-bash`、`pwsh` 还是 `powershell`，都优先使用 `/` 分隔的 workspace 相对路径，例如 `packages/app`。

```json
{
  "command": "pnpm build",
  "path": "gateway-vscode"
}
```

扩展内部会把 `path` 解析为 VS Code 终端或子进程需要的真实目录，但工具入参和 `run_in_terminal`、`terminal_session` 返回的 session summary 只暴露 workspace 相对 `path`。

命令文本中的文件参数采用另一套策略：workspace 内路径默认允许；workspace 外字面量路径和无法静态确认的动态路径需要逐次审批。用户可以通过 `webcodeGateway.command.allowedRoots` 增加可信绝对目录，支持 `~` 和 `${workspaceFolder}`。外部递归删除、系统级 PowerShell provider 等高风险目标仍会拒绝。

## 运行模型

优化后，`run_in_terminal` 不再创建伪终端，而是使用 VS Code 真实集成终端：

```ts
vscode.window.createTerminal({
  name,
  cwd: resolvedAbsoluteDirectory,
  env,
  shellPath,
  shellArgs
});
```

如果选择的是 `default` profile，则不传 `shellPath` 和 `shellArgs`，让 VS Code 自己使用用户当前默认终端配置。

命令执行优先使用 VS Code shell integration：

```ts
terminal.shellIntegration.executeCommand(commandLine);
```

这样 VS Code 可以在支持的 shell 中报告命令开始、命令结束、退出码和命令输出。

如果 shell integration 在短时间内没有激活，工具会降级为：

```ts
terminal.sendText(commandLine, true);
```

降级后命令仍会发送到真实终端执行，用户也能看到，但 AI 侧无法可靠知道完整输出和退出码。

## Terminal profile 选择

`run_in_terminal` 和 `execute_command` 都支持 `profile` 参数，用于选择执行命令的 shell 类型：

```json
{
  "command": "pnpm dev",
  "profile": "default"
}
```

当前只向 AI 暴露常用且相对稳定的 profile：

| profile | 语法 | 说明 |
| --- | --- | --- |
| `default` | 按 VS Code 默认终端判断 | 尊重用户 VS Code 当前默认终端，普通项目命令优先使用。 |
| `git-bash` | POSIX/bash | 适合 `CI=true sh script.sh`、`./script.sh` 等 bash 风格命令。 |
| `pwsh` | PowerShell | PowerShell 7，适合 `$env:CI='true'; pnpm build` 等命令。 |
| `powershell` | PowerShell | Windows PowerShell 5，作为没有 pwsh 时的兼容选择。 |

`cmd` 暂不暴露。原因是 cmd 语法与 POSIX/PowerShell 差异较大，shell integration 支持较弱，且更容易引入不稳定行为。

## profile 发现与去重

工具列表初始化时，浏览器插件会调用 `list_tools`。网关会在这一步动态生成 `run_in_terminal` 和 `execute_command` 的工具描述，把当前环境检测到的 profile 写进 description 和字段说明里。

来源优先级：

1. `default`：VS Code 当前默认终端。
2. 用户配置的 `terminal.integrated.profiles.<platform>`。
3. `webcodeGateway.commandShell.path` 中配置的 Git Bash。
4. 自动探测的常见路径，例如 Git Bash、PowerShell 7、Windows PowerShell。

去重策略：

- `default` 单独保留，因为它代表“尊重用户 VS Code 默认终端”。
- 其他 profile 按 profile id 去重。
- 非 default profile 会按 shell 路径去重，避免同一个 `bash.exe` 或 `pwsh.exe` 重复暴露。
- 同类 profile 只保留最稳定的一个，例如多个 Git Bash 只暴露一个 `git-bash`。

如果没有检测到某个 shell，就不会把对应 profile 写进工具描述。

## 动态工具描述

模型不需要先调用 `terminal_session` 或其他探测工具。初始化提示词中的 Available Tools 已经包含动态生成后的 `run_in_terminal` 描述。

示例描述会包含类似内容：

```text
Available terminal profiles:
- default: VS Code default terminal (...). Syntax: PowerShell.
- git-bash: Git Bash. Syntax: POSIX/bash.
- pwsh: PowerShell 7. Syntax: PowerShell.
```

这样 AI 在第一次选择工具时就能根据命令语法选择 profile。

## 命令语法选择

推荐规则：

- 普通跨 shell 命令，例如 `pnpm dev`、`npm test`，优先使用 `default`。
- POSIX/bash 语法使用 `git-bash`，例如：

```bash
CI=true sh build_release.sh
```

- PowerShell 语法使用 `pwsh` 或 `powershell`，例如：

```powershell
$env:CI='true'; pnpm build
```

如果 AI 选择了错误 profile，命令可能因为语法不兼容而失败。例如把 `$env:CI='true'` 放到 Git Bash 中执行，或者把 `CI=true sh script.sh` 放到 PowerShell 中执行。

## 输出采集

`terminal_session read` 读取的是扩展为该 session 缓存的输出。

采集状态通过 session summary 的 `capture` 字段表达：

| capture | 含义 |
| --- | --- |
| `pending` | 正在等待 shell integration 激活。 |
| `shellIntegration` | shell integration 可用，输出和退出码可采集。 |
| `unavailable` | 已降级为 `sendText`，用户可见，但 AI 无法可靠采集输出、退出码和结束状态。 |

缓存输出会限制最大长度，防止长时间运行的开发服务器无限占用内存。读取时可以通过 `tail_lines` 获取最近输出。

`read` 支持 `delay_seconds`：

```json
{
  "action": "read",
  "session_id": "abc12345",
  "tail_lines": 200,
  "delay_seconds": 5
}
```

`delay_seconds` 的范围是 0 到 10，默认 0。设置为 0 表示立刻读取；设置为 5 表示等待 5 秒后再读取。这个参数适合构建、测试、打包等短时间内会结束的命令，可以减少 AI 为了等待最终输出而连续多次调用 `read`。

## 退出状态

session 状态包括：

| status | 含义 |
| --- | --- |
| `starting` | 终端已创建，命令尚未真正开始或仍在等待 shell integration。 |
| `running` | 命令已发送并正在运行，且 shell integration 可用于后续结束事件。 |
| `interrupting` | 已发送 `Ctrl+C` 请求中断，但 shell 还没有报告命令结束。 |
| `unknown` | 命令已发送，但 shell integration 不可用，无法判断命令是否仍在运行。 |
| `exited` | 命令结束且退出码为 0。 |
| `failed` | 命令结束且退出码非 0。 |
| `stopped` | 中断请求已被 shell 结束事件确认，或终端被关闭。 |

命令失败不会关闭终端窗口。真实 VS Code shell 仍然保留，用户可以继续查看输出或手动输入命令。

## stop 与 close 的区别

`terminal_session` 的 `stop` 语义是请求中断当前命令，不关闭终端：

```json
{
  "action": "stop",
  "session_id": "abc12345"
}
```

实现上会向终端发送 `Ctrl+C`：

```ts
terminal.sendText('\x03', false);
```

这更接近用户手动按 `Ctrl+C`。对于 `pnpm dev`、Vite、webpack watch 等常驻命令，预期效果是停止当前进程并回到 shell prompt。

`stop` 返回后，session 通常会先进入 `interrupting`。只有 shell integration 报告命令结束，或者用户关闭终端时，状态才会变成 `stopped`。如果命令忽略 `Ctrl+C`，它可能继续运行；如果 `capture` 是 `unavailable`，工具无法确认中断是否真正完成。

如果 `stop` 发生在 session 仍处于 `starting`，且命令还没有发送到 shell 的短窗口内，工具会取消后续命令发送。此时终端窗口仍会保留，session 会保持 `interrupting`，直到用户关闭终端或后续扩展出更明确的取消完成状态。

如果需要关闭终端标签页，应使用 `close`：

```json
{
  "action": "close",
  "session_id": "abc12345"
}
```

## 安全策略

Gateway 是命令风险判断的权威入口。浏览器在执行命令前调用预检接口，风险分为三级：

| 等级 | 行为 | 示例 |
| --- | --- | --- |
| `allowed` | 按普通工具授权规则执行 | 构建、测试、只读 git、workspace 内常规命令 |
| `requires_confirmation` | 即使启用自动批准也必须逐次确认 | inline eval、嵌套 shell、递归删除、破坏性 git、动态路径、workspace 外路径 |
| `blocked` | 不提供继续执行入口 | 提权、下载后管道进入 shell、编码 PowerShell、删除 workspace 根或 `.git`、系统管理命令 |

必须确认的命令采用一次性 challenge。用户批准后，Gateway 签发短期单次凭据；凭据绑定工具名、原始命令、执行目录和 shell profile，不能用于另一条命令或重复使用。永久命令授权同样绑定执行目录和 profile，复合命令不能按宽泛前缀授权。

POSIX 和 PowerShell 使用结构化词法解析识别顶层命令、连接符、管道和字面量嵌套 shell。字面量嵌套命令会递归评估，例如普通 `bash -c` 需要确认，但 `bash -c 'rm -rf .'` 会直接拒绝。动态命令替换、PowerShell script block、动态调用和 .NET 静态调用会升级为逐次确认。

PowerShell 另外拒绝 `Invoke-Expression`、encoded command、非文件系统 provider 和系统管理命令。后台 PowerShell profile 使用 `-NoProfile -NonInteractive`，降低用户 profile、alias 和交互提示带来的不确定性。

这些检查是风险防护，不是操作系统沙箱。脚本、包管理器生命周期、编译器和 workspace 内程序仍可能访问其进程权限允许的资源；如果需要严格文件系统隔离，需要单独的容器或 OS sandbox 执行模式。

## 与 execute_command 的边界

当前边界：

- 短命令、构建、测试优先使用 `execute_command`。
- 常驻命令、可见输出、交互式流程使用 `run_in_terminal`。
- `execute_command` 可显式选择 PowerShell profile；该模式不加载用户 profile，并保持非交互执行。
- `run_in_terminal` 使用真实 VS Code 终端，适合依赖用户终端环境的流程。

## 已知边界

- shell integration 依赖 VS Code 和用户 shell 配置。部分 shell 或用户自定义启动脚本可能导致 integration 不可用。
- 降级到 `sendText` 时，AI 无法可靠判断命令是否结束，也无法拿到退出码。
- `default` profile 的实际 shell 由 VS Code 决定。如果无法判断其语法类型，工具会更保守地处理或要求选择明确 profile。
- `stop` 是发送 `Ctrl+C` 请求中断，不是强杀进程树。正常程序应响应中断；如果进程忽略中断，后续可以考虑增加单独的 `kill` 动作。
- 当前不暴露 `cmd`，也没有专门支持 WSL profile。后续可按需求扩展。

## 后续可扩展方向

- 增加 `kill` 动作，用于在 `Ctrl+C` 无法停止时强制结束进程树。
- 增加更明确的 profile 测试工具，帮助诊断 shell integration 是否可用。
- 支持用户显式白名单 profile，例如允许高级用户暴露 WSL 或自定义 shell。
- 在 UI 中展示 session capture 状态，让用户知道当前输出是否可被 AI 读取。
- 为 PowerShell 风险策略增加更多测试用例和更细粒度的参数解析。
