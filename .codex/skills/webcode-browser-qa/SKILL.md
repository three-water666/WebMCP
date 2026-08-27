---
name: webcode-browser-qa
description: Lead interactive end-to-end QA for WebCode changes across real AI sites, the browser bridge and popup, Gateway, and VS Code. Use after changes to capture, initialization, approvals, result delivery, selectors, browser launch, extension UI, settings, commands, or editor navigation; do not use for ordinary unit-only changes.
---

# WebCode Browser QA

Use this workflow to explore the affected product flow, adapt actions to observed state, collect
evidence, and report bugs. Agent-eval scenarios may supply a fixed task, isolated code fixture,
and optional deterministic checks, but the Codex operator owns the test actions and verdict.

Read [references/commands.md](references/commands.md) before starting a session. Read only the
relevant section of [references/charters.md](references/charters.md) for the changed behavior.
Also use the `playwright-cli` skill for all browser and VS Code Workbench operations.

## Workflow

1. Start an isolated session with `pnpm qa:start <site-id> [scenario-id]` and retain the run id.
   Prefer an agent-eval scenario when the model should work on a fixed, verifiable coding task.
2. Inspect `pnpm qa:ctl <run> status` and, when present, `pnpm qa:ctl <run> task`. Snapshot both
   affected UI targets before acting. Send only the task text to the model; never send grader code.
3. Exercise the changed flow interactively. Choose the next action from the current snapshot,
   console, requests, Gateway trace, and Extension Host state rather than assuming a fixed page.
4. Verify cross-surface effects twice when practical: visible UI through Playwright and internal
   state through `qa:ctl` or `trace.jsonl`.
5. Inspect `pnpm qa:ctl <run> review` and the resulting workspace before deciding whether the task
   and product flow succeeded. A scenario grader is optional corroboration, not the final verdict.
6. Save screenshots for important success and failure states. Record concise reproduction steps
   and artifact paths for every bug.
7. Always run `pnpm qa:stop <run>` when finished, including after a failed investigation.

Use the isolated run workspace for tool calls. Do not approve destructive, external, or unrelated
operations merely to advance a test. Authentication, CAPTCHA, 2FA, browser-native prompts, and
high-risk approvals may require the user to take over the visible session.

Report task correctness, tool-use discipline, recovery behavior, UI clarity, and user friction.
State which UI and internal evidence support the verdict and any coverage that remained blocked.
Do not treat a started session, successful click, or deterministic grader pass as proof that the
full product flow passed.
