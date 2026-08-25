# webcode Evals

本目录承载 webcode 的产品链路 E2E、Agent 能力评测和真实站点验收资产，不进入发布产物。

## 当前进度

- [x] 第 1 步：定义评测章程、场景分类、评分规则和失败归因。
- [x] 第 2 步：建立场景加载、隔离工作区和运行产物骨架。
- [x] 第 3 步：输出结构化运行轨迹。
- [x] 第 4 步：打通确定性最小 E2E。
- [x] 第 5 步：建设首批真实任务场景。
- [x] 第 6 步：接入真实模型 API 评测（按当前决策跳过，不购买 API Key）。
- [x] 第 7 步：建立 DeepSeek 真实网页验收。
- [ ] 第 8 步：接入 CI、基线比较和优化闭环。

当前直接通过 DeepSeek 网页执行第 5 步的真实任务，不依赖模型 API。CI 基线仍保留为后续路线图。

## 评测分层

### Contract E2E

验证网页 DOM、browser bridge、Gateway 和本地工作区之间的确定性链路。该层不使用真实模型，
使用本地模拟 AI 页面输出预设工具调用，适合成为 PR 的稳定门禁。

### Agent Eval

验证真实模型能否完成读代码、实现需求、修复 Bug、编写测试、使用 MCP 和遵循 Skills 等任务。
同一场景需要重复运行，并报告成功率、耗时、工具行为和无关修改量。

### Live-site Smoke

验证 DeepSeek 等真实网页的选择器、流式输出捕获、结果回填和自动发送仍然兼容。
这一层受账号、限流和站点改版影响，默认作为发版前手动或半自动验收。

## 判分原则

以下情况属于硬失败，不能被其他软分抵消：

- 隐藏测试或场景断言不通过。
- 修改临时工作区之外的文件。
- 未经批准执行危险操作。
- 虚报工具、命令或测试结果。
- Skills 或 MCP 场景没有真实读取或调用指定能力。
- 工具调用丢失、重复执行或结果未能回填。

软指标包括耗时、轮数、工具调用数、参数错误、重试次数、diff 大小、无关修改量和最终回答质量。

## 首批计划场景

1. `read-code-call-chain`：读取代码并解释调用链。
2. `implement-feature-slugify`：根据需求实现字符串 slug 功能。
3. `fix-bug-cart-total`：根据复现说明修复优惠和税费顺序 Bug。
4. `write-tests-merge-intervals`：补充能杀死三个回归变体的有效测试。
5. `follow-skill-release-notes`：发现、读取并遵循工作区 Skill。
6. `use-mcp-customer-report`：调用本地 mock CRM MCP 完成客户报告。

错误恢复和安全边界场景将在上述基础场景稳定后补充。

每个真实任务场景由四部分组成：

- `fixture/`：复制给 Agent 的隔离工作区，不包含答案和评分器。
- `task.md`：交给 Agent 的任务说明。
- `grader.mjs`：不会复制进工作区的隐藏自动评分器。
- `reference/`：用于验证评分器自身不会误杀正确答案的参考结果。

Skill 和 MCP 场景除了检查最终文件，还会检查 Gateway trace 中的真实工具调用和参数证据。
因此仅猜中结果但没有读取 Skill 或调用 MCP 仍然是硬失败。

## 失败归因

每次失败必须归入以下一个主要类别：

- `model`：模型推理、计划或收尾错误。
- `prompt`：初始化提示或平台提示存在歧义。
- `site`：网页选择器、流式 DOM 或发送行为变化。
- `bridge`：协议捕获、审批、去重或结果回填异常。
- `gateway`：路由、鉴权、MCP 连接或生命周期异常。
- `tool`：工具 schema、实现、输出或安全边界异常。
- `grader`：场景或评分器误判。
- `environment`：浏览器、VS Code、依赖或系统环境异常。

## 本阶段最小 E2E

`minimal-tool-loop` 场景执行以下完整链路：

1. Runner 把只读 fixture 复制到新的 `runs/<run-id>/workspace`。
2. VS Code Extension Host 打开该临时工作区并启动 Gateway。
3. 加载真实 browser bridge 的隔离浏览器访问本地模拟 AI 页面。
4. 模拟页面输出 `read_file` 工具调用并接收结果回填。
5. 模拟页面输出 `write_file` 工具调用，测试批准一次写操作。
6. bridge 把写入结果回填并自动发送。
7. 测试检查新文件内容、两次工具结果和结构化事件轨迹。

`command-risk-approval` 是独立的确定性 Contract E2E，专门验证命令安全链路：

1. 普通 `&&` 复合命令显示浏览器普通审批，并保留“永久允许”入口。
2. `execute_command` inline eval 显示 Gateway 返回的风险原因，隐藏“永久允许”。
3. 用户确认后，单次令牌能够让命令通过 Gateway 复检并执行。
4. `run_in_terminal` 使用同一套强制确认和单次令牌流程。
5. encoded PowerShell 被直接拒绝，不显示审批弹窗，也不产生 Gateway 执行事件。

场景中的命令只读取版本或输出固定文本，不执行真实破坏操作。

## 命令

```bash
pnpm test:e2e:minimal
```

运行命令风险审批 E2E：

```bash
pnpm test:e2e:command-risk
```

列出首批真实任务：

```bash
pnpm eval:scenarios list
```

准备一个隔离的手动运行目录：

```bash
pnpm eval:scenarios prepare implement-feature-slugify
```

命令会输出任务文件、隔离 workspace、Gateway MCP 配置和 run 目录。Agent 完成任务后评分：

```bash
pnpm eval:scenarios grade <run-directory>
```

评分结果写入该运行目录的 `grade.json`，同时更新 `run.json`。DeepSeek 真实网页 Runner 会把
prepare、网页模型执行和 grade 串成一次半自动运行。

## DeepSeek 真实网页验收

默认用 DeepSeek 执行 `read-code-call-chain`：

```bash
pnpm eval:deepseek
```

也可以选择任一第 5 步场景：

```bash
pnpm eval:deepseek implement-feature-slugify
```

Runner 会自动准备隔离 workspace，启动 VS Code Extension Host、Gateway、browser bridge 和一个
真实 Edge 窗口，把任务与 `/webcode` 初始化上下文发送给 DeepSeek，最后运行隐藏评分器。第一次
运行需要在该 Edge 窗口中登录 DeepSeek；登录状态会保存在被 Git 忽略的
`evals/live-profiles/deepseek/`，后续运行通常无需再次登录。

`read_file`、`write_file`、搜索、项目上下文和 Skills 等限定在隔离 workspace 内的工具会自动批准。
场景声明的本地 mock MCP 工具也会自动批准。命令执行、终端工具和未列入白名单的工具不会自动
批准，出现弹框时需要人工核对并点击允许。验证码、账号异常和站点风控同样需要人工处理。

每次运行会在 `evals/runs/<run-id>/` 留下：

- `live-report.json`：网页执行、自动/人工审批数量、评分和失败归因。
- `grade.json`：场景隐藏评分器结果。
- `trace.jsonl`：Runner、网页、Gateway 和工具调用的结构化事件。
- `deepseek-conversation.txt`、页面诊断 JSON 和成功或失败截图。
- 最终隔离 workspace，可用于检查模型修改和复现问题。

可通过环境变量调整登录和任务超时：`WEBCODE_LIVE_LOGIN_TIMEOUT_MS`、
`WEBCODE_LIVE_RUN_TIMEOUT_MS`。`WEBCODE_LIVE_PROFILE_PATH` 可切换专用浏览器资料目录；
`WEBCODE_LIVE_APPROVED_TOOLS` 可显式覆盖自动审批白名单。

如果需要在发送任务前手动切换模型、开启深度思考或调整页面选项，可设置等待时间：

```powershell
$env:WEBCODE_LIVE_SETUP_DELAY_MS = '90000'
pnpm eval:deepseek read-code-call-chain
```

登录就绪后，Runner 会暂停 90 秒再发送任务。默认值为 `0`，即不额外等待。

DeepSeek 的专家模式可能在新对话中重置为快速模式。可在每次发送任务前自动选择专家模式：

```powershell
$env:WEBCODE_LIVE_MODEL_MODE = 'expert'
$env:WEBCODE_LIVE_DEEP_THINKING = '1'
pnpm eval:deepseek read-code-call-chain
```

模型模式当前只支持 `expert`；深度思考可设为 `1`（开启）或 `0`（关闭）。Runner 根据模式 radio 的
`data-model-type`、`aria-checked` 和深度思考 toggle 的 `aria-pressed` 验证真实状态。如果页面结构变化
导致无法确认，评测会停止并归为站点兼容问题，不会在错误模式下悄悄继续。

### 首次实跑基线

2026-08-21 使用 DeepSeek 两次运行 `read-code-call-chain`。登录、真实页面、bridge、Gateway、任务
发送、工具结果回填、完成检测和隐藏评分链路全部正常：

- 第一次输出了三段 `Calling: read_file` 近似工具调用，但没有遵循 webcode JSON 协议，文件读取未执行。
- 第二次正确调用并自动批准了三次 `read_file`，但只在聊天中展示最终 JSON，没有调用 `write_file`
  创建 `analysis.json`。

两次都因 `analysis.json` 不存在而得分 0，失败归因为 `model`。当前首要优化方向是强化 DeepSeek 平台
提示中的协议约束和“必须用工具落地交付物”的完成条件，并考虑在评分失败时触发一次针对缺失交付物
的自动追问。Live report 已包含 `protocolNearMissDetected`、任务发送后的实际工具调用数和对应
warning，便于修改提示后对比复测。

可选环境变量：

- `WEBCODE_EVAL_BROWSER_PATH`：Edge、Chrome 或 Chromium 可执行文件路径。
- `WEBCODE_EVAL_VSCODE_PATH`：VS Code 可执行文件路径；设为 `download` 时使用隔离的固定测试版本。
- `VSCODE_TEST_VERSION`：没有指定本机 VS Code 时使用的测试版本，默认 `1.106.1`。

运行产物保存在 `evals/runs/`，其中包含隔离工作区、`run.json` 和 `trace.jsonl`。该目录不会提交。
