# Repository Guidelines

## Commit Message Guidelines

-   Use a concise Conventional Commit title, for example `feat: improve OCR settings status and upload flow`.
-   If a change is small and the title fully explains it, a one-line commit message is enough.
-   If a change touches multiple behaviors, files, or user-facing flows, add a commit body.
-   Keep the commit body focused on what changed in the code.
-   Write body entries as bullet points prefixed with `- `.
-   Keep body lines under the repository commitlint limit of 100 characters.
-   Do not include routine process notes such as commands run, build verification, lint results, or hook output.
-   Do not describe the work as a personal action log. Prefer code and behavior descriptions.

Good body example:

```text
- Show OCR download and enabled states as separate badges in the language list.
- Add semantic styles for OCR action buttons and language card states.
- Move the OCR package source link from the list into a manual upload dialog.
```

Avoid body entries like:

```text
- Verified with pnpm --filter edge_translate build.
- Ran format:staged and lint:staged.
- I updated the tests.
```

## Interactive QA Guidelines

- After changes to browser capture, bridge behavior, popup or initialization flows, approvals,
  result delivery, site selectors, browser launching, or VS Code integration UI, you may remind
  the user that the `webcode-browser-qa` skill is available.
- Do not invoke the interactive QA workflow or start a QA session unless the user explicitly asks
  for it or agrees to the suggestion.
- When the user authorizes interactive QA, treat `test:e2e:minimal` as a deterministic regression
  check, not a replacement for agent-led inspection of the affected real UI flow.
- Run authorized interactive QA in the isolated workspace and profiles created by `qa:start`; do
  not point browser-driven tool calls at the repository working tree.
