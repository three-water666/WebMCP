# 仓库指南

语言：中文 | [English](AGENTS_en.md)

## 提交信息指南

- 使用简洁的 Conventional Commit 标题，例如
  `feat: improve OCR settings status and upload flow`。
- 如果改动较小，且标题已经能够完整说明改动，使用单行提交信息即可。
- 如果改动涉及多种行为、多个文件或用户可见流程，请添加提交正文。
- 提交正文应专注于代码发生了哪些变化。
- 正文条目使用以 `- ` 开头的项目符号。
- 正文每行不得超过仓库 commitlint 规定的 100 个字符。
- 不要包含运行命令、构建验证、lint 结果或 hook 输出等常规过程记录。
- 不要把改动描述成个人操作日志，优先描述代码和行为变化。

合适的正文示例：

```text
- Show OCR download and enabled states as separate badges in the language list.
- Add semantic styles for OCR action buttons and language card states.
- Move the OCR package source link from the list into a manual upload dialog.
```

避免使用以下正文条目：

```text
- Verified with pnpm --filter edge_translate build.
- Ran format:staged and lint:staged.
- I updated the tests.
```

## 交互式 QA 指南

- 修改浏览器捕获、桥接行为、弹窗或初始化流程、审批、结果传递、站点选择器、
  浏览器启动或 VS Code 集成 UI 后，可以提醒用户 `webcode-browser-qa` 技能可用。
- 除非用户明确要求使用或同意建议，否则不要调用交互式 QA 工作流或启动 QA 会话。
- 用户授权交互式 QA 后，应将 `test:e2e:minimal` 视为确定性回归检查，
  而不是由智能体检查受影响真实 UI 流程的替代方案。
- 获得授权的交互式 QA 必须在 `qa:start` 创建的隔离工作区和配置文件中运行；
  不要让浏览器驱动的工具调用指向仓库工作树。
