---
name: release-note
description: Generate concise public release notes from changes.json.
---

# Release note instructions

Read `changes.json` and write `RELEASE_NOTES.md` using exactly this structure:

```text
# Release <version> — <date>

## Highlights
<public feature entries as bullets, ordered by id>

## Fixes
<public fix entries as bullets, ordered by id>

## Upgrade note
<upgradeNote from changes.json>
```

Rules:

- Include only entries whose `public` field is `true`.
- Rewrite entries as user-facing sentences; do not include IDs or internal implementation terms.
- Keep product names and inline code formatting from the source text.
- End the file with exactly one newline.
