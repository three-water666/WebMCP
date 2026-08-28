---
name: webcode-browser-qa
description: Suggest interactive end-to-end QA for relevant WebCode browser and VS Code changes, and lead it only after the user explicitly requests or approves the workflow. Do not start QA automatically after changes or use it for ordinary unit-only changes.
---

# WebCode Browser QA

Use this workflow to explore the affected product flow, adapt actions to observed state, collect
evidence, and report bugs after the user authorizes interactive QA. Agent-eval scenarios may
supply a fixed task, isolated code fixture, and optional deterministic checks, but the Codex
operator owns the test actions and verdict.

## Authorization

- After relevant changes to capture, initialization, approvals, result delivery, selectors,
  browser launch, extension UI, settings, commands, or editor navigation, you may tell the user
  this skill is available and briefly state what it would validate.
- Do not run `qa:start`, open or drive a browser or VS Code session, or otherwise begin this
  workflow unless the user explicitly requests it or agrees to the suggestion.
- A request to implement, fix, review, or test the code does not by itself authorize interactive
  QA. Ordinary unit, build, lint, and deterministic checks remain within the original task scope.
- If the user does not authorize interactive QA, do not block completion; report that it was not
  run when that context is useful.

After authorization, read the repository-root `README.md` for the current WebCode setup and basic
conversation workflow, then read [references/commands.md](references/commands.md) before starting
a session. Read only the relevant section of [references/charters.md](references/charters.md) for
the changed behavior. Also use the `playwright-cli` skill for all browser and VS Code Workbench
operations.

## Authorized Workflow

1. Start an isolated session with `pnpm qa:start [site-id] [scenario-id]` and retain the run id.
   Use `deepseek` when the user does not specify a site, and honor an explicitly requested built-in
   or configured site. Prefer an agent-eval scenario when the model should work on a fixed,
   verifiable coding task.
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
operations merely to advance a test. If the target AI site is not logged in, pause and ask the user
to log in manually in the visible isolated browser window. Do not enter credentials, solve CAPTCHA
or 2FA, or bypass authentication; continue only after the signed-in state is visible. Browser-native
prompts and high-risk approvals may also require the user to take over the visible session.

Report task correctness, tool-use discipline, recovery behavior, UI clarity, and user friction.
State which UI and internal evidence support the verdict and any coverage that remained blocked.
Do not treat a started session, successful click, or deterministic grader pass as proof that the
full product flow passed.
