# WebCode Interactive QA Charters

Language: English | [中文](charters.md)

Select the sections that match the change. Adapt exact actions to current site state.

## Baseline connection

- Confirm the real site and VS Code Workbench are both visible and Playwright snapshots succeed.
- Confirm `qa:ctl status` reports the WebCode extension active and Gateway running on the run port.
- Confirm the browser popup reports the expected bridge/session connection.
- Check page errors, relevant console warnings, and unexpected failed requests before the flow.

## Fixed coding scenario review

- Select a scenario whose fixture and required behavior overlap the feature under test; do not use
  a harder task merely to make the run look more realistic.
- Read the copied task with `qa:ctl task` and send only that prompt to the model.
- Observe how the model discovers files, invokes tools, handles approval and result delivery, and
  recovers from ambiguity. Intervene only as a tester would for login, risk review, or site failure.
- Compare the final conversation, `qa:ctl review`, changed file contents, VS Code state, and any
  scenario-specific tests. Use the hidden grader only as an additional correctness signal.
- Give an agent-owned verdict across task correctness, tool discipline, recovery, UI clarity, and
  friction. Attribute failures separately to model, site, bridge, Gateway, VS Code, or scenario.

## Initialization and popup

- On a fresh conversation, type an ordinary first message and press Enter.
- Confirm interception opens the initialization prompt instead of losing or duplicating the text.
- Click `Add`/`添加` or press Enter in the prompt. Confirm the initialization context is inserted
  once, the original task remains present, and the message is not sent automatically.
- Press Enter or click the site's send button again. Confirm exactly one user message is sent.
- In a separate fresh conversation, cancel once and verify the draft remains usable.
- Open the browser popup and invoke manual initialization.
- Confirm the initialization context is inserted once and the original task can still be sent.
- Reload and repeat the action that is expected to persist or reset.

## Tool capture and activity status

- Send a safe task that produces at least one read-only tool call and, when relevant, a write call
  confined to the isolated run workspace.
- For network capture, inspect captured, queued, approval, executing, elapsed-time, result-delivery,
  success, and failure states in the activity panel.
- Expand the corresponding DOM tool block when available and verify the logical call executes once.
- Compare browser state with Gateway `tool_call_started` and `tool_call_finished` trace events.
- Confirm successful rows collapse as designed and failures remain inspectable.

## Approval and result delivery

- Verify read-only and mutating tools receive the intended approval treatment.
- Reject one safe test request when the changed code affects rejection handling.
- Confirm long-running execution remains visibly active and does not look frozen.
- Confirm the result reaches the AI input, is sent once, and the conversation continues.
- Reload during a non-destructive stage when recovery or deduplication behavior changed.

## VS Code UI, settings, and navigation

- Use Workbench Playwright to exercise the visible command, setting, status item, or extension UI.
- Use Extension Host control to verify the resulting configuration, command effect, active editor,
  file path, line, and column.
- For browser-to-editor navigation, click in the browser, then verify both the Workbench screenshot
  and `vscode state`.
- Real enable/disable coverage requires an isolated profile with the packaged VSIX rather than only
  an extension-development launch. Record this as separate coverage when the feature depends on
  installation state.

## Failure reporting

Record the run id, site, exact observed state, shortest reproduction, expected behavior, relevant
trace or log events, screenshots, and whether the failure belongs to site, bridge, Gateway, VS Code,
or environment behavior.
