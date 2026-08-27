---
name: playwright-cli
description: Drive browser or Electron UI sessions with the repository-pinned Playwright CLI during interactive WebCode QA. Use for snapshots, clicks, typing, screenshots, network inspection, console inspection, tracing, and arbitrary Playwright probes; do not use it to replace Extension Host state checks.
---

# Playwright CLI

Before operating a UI, read the complete official Playwright CLI skill installed at
`evals/node_modules/@playwright/cli/skills/playwright-cli/SKILL.md`. Read only the official
references it routes to for the current operation.

For sessions created by WebCode QA, preserve the official command and arguments but invoke them
through the run-aware proxy:

```text
pnpm qa:pw <run> <browser|vscode> <official playwright-cli command...>
```

The proxy selects the attached named session and otherwise leaves Playwright behavior intact.
Use `browser` for the AI site and browser-extension pages. Use `vscode` for the VS Code Workbench.

Take a fresh snapshot before choosing an element reference. Use screenshots when visual evidence
matters, then inspect the saved image. Prefer `console`, `requests`, tracing, and a focused
`run-code` probe when the visible page does not explain a failure.

Run commands against the same target session sequentially. Parallel commands can race over the
session's selected tab and generated element references.

Do not use Playwright UI observations as proof of Extension Host internals. Pair them with
`pnpm qa:ctl <run> vscode state`, configuration inspection, or Gateway trace evidence when the
behavior crosses into VS Code.
