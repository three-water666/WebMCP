# webcode Evals

本目录承载 webcode 的产品链路 E2E、Agent 能力评测和真实站点验收资产，不进入发布产物。

## 当前进度

- [x] 第 1 步：定义评测章程、场景分类、评分规则和失败归因。
- [x] 第 2 步：建立场景加载、隔离工作区和运行产物骨架。
- [x] 第 3 步：输出结构化运行轨迹。
- [x] 第 4 步：打通确定性最小 E2E。
- [x] 第 5 步：建设首批真实任务场景。
- [ ] 第 6 步：接入真实模型评测。
- [ ] 第 7 步：建立真实网页验收。
- [ ] 第 8 步：接入 CI、基线比较和优化闭环。

当前实现落实到第 5 步。真实模型执行、真实网页验收和 CI 基线仍保留为后续路线图。

## 评测分层

### Contract E2E

验证网页 DOM、browser bridge、Gateway 和本地工作区之间的确定性链路。该层不使用真实模型，
使用本地模拟 AI 页面输出预设工具调用，适合成为 PR 的稳定门禁。

### Agent Eval

验证真实模型能否完成读代码、实现需求、修复 Bug、编写测试、使用 MCP 和遵循 Skills 等任务。
同一场景需要重复运行，并报告成功率、耗时、工具行为和无关修改量。

### Live-site Smoke

验证 ChatGPT、Gemini 等真实网页的选择器、流式输出捕获、结果回填和自动发送仍然兼容。
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

## 命令

```bash
pnpm test:e2e:minimal
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

评分结果写入该运行目录的 `grade.json`，同时更新 `run.json`。第 6 步会把 prepare、真实模型执行和
grade 串成一次全自动运行。

可选环境变量：

- `WEBCODE_EVAL_BROWSER_PATH`：Edge、Chrome 或 Chromium 可执行文件路径。
- `WEBCODE_EVAL_VSCODE_PATH`：VS Code 可执行文件路径。
- `VSCODE_TEST_VERSION`：没有指定本机 VS Code 时使用的测试版本，默认 `1.106.1`。

运行产物保存在 `evals/runs/`，其中包含隔离工作区、`run.json` 和 `trace.jsonl`。该目录不会提交。
