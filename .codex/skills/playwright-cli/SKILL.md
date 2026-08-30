---
name: playwright-cli
description: 在 WebCode 交互式 QA 中，使用仓库固定版本的 Playwright CLI 驱动浏览器或 Electron UI 会话。适用于快照、点击、输入、截图、网络检查、控制台检查、追踪和任意 Playwright 探测；不要用它替代 Extension Host 状态检查。
---

# Playwright CLI

语言：中文 | [English](SKILL_en.md)

操作 UI 前，完整阅读安装在
`evals/node_modules/@playwright/cli/skills/playwright-cli/SKILL.md` 的官方 Playwright CLI
技能。只阅读该技能针对当前操作所指向的官方参考文档。

对于 WebCode QA 创建的会话，保留官方命令及其参数，但通过能够识别运行实例的代理调用：

```text
pnpm qa:pw <run> <browser|vscode> <official playwright-cli command...>
```

该代理会选择已附加的命名会话，除此之外不会改变 Playwright 的行为。AI 站点和浏览器扩展页面
使用 `browser`，VS Code Workbench 使用 `vscode`。

选择元素引用前先获取最新快照。需要视觉证据时使用截图，然后检查保存的图像。如果可见页面无法
解释故障，优先使用 `console`、`requests`、追踪以及针对性的 `run-code` 探测。

针对同一个目标会话依次运行命令。并行命令可能争用会话当前选中的标签页和生成的元素引用。

不要把 Playwright UI 观察结果当作 Extension Host 内部状态的证明。当行为涉及 VS Code 时，
应结合 `pnpm qa:ctl <run> vscode state`、配置检查或 Gateway 追踪证据进行判断。
