# Interactive QA Commands

Language: English | [中文](commands.md)

## Lifecycle

```text
pnpm qa:start
pnpm qa:start chatgpt
pnpm qa:start deepseek read-code-call-chain
pnpm qa:status <run>
pnpm qa:stop <run>
```

`qa:start` builds the bridge and VS Code extension, copies the deterministic fixture to an
isolated workspace, starts the Extension Host and Gateway, opens a persistent site profile with
the built bridge, opens a source file in the Workbench, and attaches Playwright CLI sessions for
the browser and VS Code Workbench. The optional second argument selects any `agent-eval` scenario
under `evals/scenarios`; without it, the minimal bridge fixture is used.
VS Code user data and extensions are isolated inside the run. `qa:status` reports `degraded` if a
host process or the authenticated control channel disappears while the manifest still says running.

Omitting the site id selects `deepseek`. The built-in site ids are `chatgpt`, `gemini`, `aistudio`,
`deepseek`, `glm`, `claude`, and `qwen`. Honor a site named by the user. A custom site id can be used
after its complete `webcodeGateway.aiSites` configuration is available in the isolated Extension
Host; do not imply that an unconfigured site is supported.

`qa:start` uses locally installed browser and VS Code executables from known default locations.
If either executable is not found, locate it, set `WEBCODE_EVAL_BROWSER_PATH` or
`WEBCODE_EVAL_VSCODE_PATH` to its full path, and retry. Do not set
`WEBCODE_EVAL_VSCODE_PATH=download` unless the user explicitly wants the fixed test runtime to be
downloaded; VS Code is never downloaded as an implicit fallback.

Use another built-in site id when that platform is under test. Login state is stored under the
ignored `evals/live-profiles/<site-id>/` directory.

## Playwright

All arguments after the target are official Playwright CLI arguments:

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

Read `popupUrl` with `pnpm qa:ctl <run> popup-url`, then open it with `tab-new` in the browser
session. A popup opened as a normal tab initially sees itself as Chrome's active tab, unlike a
toolbar popup. Prepare the extension page against its stored target session before judging status:

```text
pnpm qa:pw <run> browser tab-new <popup-url>
pnpm qa:pw <run> browser run-code --filename=scripts/qa-popup-ready.js
pnpm qa:pw <run> browser snapshot
```

The helper keeps the AI target active, reloads the extension page, and returns both target details
and popup text. Use `tab-list` and `tab-select` to move between the AI site and popup. Run all
`qa:pw` commands sequentially, including commands for different targets, because they share one CLI
daemon. If a named session disappears, `qa:pw` automatically reattaches to the run's CDP endpoint.

## Extension Host and Gateway

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

On PowerShell, quote JSON so it reaches the control script as one argument. Prefer configuration
reads and commands in the isolated Extension Host over modifying personal VS Code state.

`task` returns the fixed prompt copied into the run. Send the task text to the site without exposing
the scenario manifest or grader. `review` summarizes workspace additions/modifications/deletions and
the tool-event timeline; inspect changed file contents and the visible conversation before judging.
After the UI investigation is finished and the session is stopped, an agent-eval grader can be run
as optional evidence with `pnpm eval:scenarios grade <run-id>`.

## Artifacts

Each run stores `run.json`, `trace.jsonl`, process logs, Playwright output, screenshots, the
isolated workspace, and browser/Extension Host descriptors under `evals/runs/<run-id>/`.
Relative `screenshot --filename=...` paths are placed under the run's `artifacts/browser/` or
`artifacts/vscode/` directory automatically.

If startup fails, inspect `logs/vscode.stderr.log`, `logs/vscode.stdout.log`,
`logs/browser.stderr.log`, and `browser-host.json` before retrying.
