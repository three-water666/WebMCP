---
name: release-package
description: Automate the webcode release workflow. Use when the user asks to publish or release a new webcode package/version, says "发新的包", "发布新版本", "打版本", "发版", "release a new package", or asks to bump versions, generate changelog entries, commit, tag, and push so the tag-triggered GitHub Actions release workflow can publish artifacts.
---

# Release Package

Language: English | [中文](SKILL.md)

## Workflow

Follow this sequence end-to-end unless the user explicitly asks to stop earlier.

1. Resolve the target version.
   - If the user provides a version, use it.
   - If not, infer the next patch version from the highest local semver tag or current release
     package version, then state the assumption before editing.
   - Use bare semver tags like `0.6.3`, matching this repository's existing tag convention. Do not
     use `v0.6.3` unless the user explicitly requests it.

2. Run preflight checks.
   - Check `git status --short`; stop and ask if unrelated changes are present.
   - Check whether the target tag already exists with `git tag --list <version>`; never overwrite
     or move an existing release tag.
   - Identify the previous release tag with `git tag --list --sort=-v:refname`.

3. Update release versions.
   - Update `gateway-vscode/package.json`.
   - Update `bridge-browser/package.json`.
   - Update `bridge-browser/manifest.json`.
   - Do not change the root `package.json` or `shared/package.json` versions unless the user
     explicitly asks; those are not release artifact versions in this repo.

4. Generate changelog entries.
   - Treat commit history as source material, not the changelog structure.
   - Review `git log --oneline <previous-tag>..HEAD`, plus any current release-version edits if
     relevant.
   - Group commits by merged PR first, then by coherent standalone topic for commits not tied to a
     PR.
   - Use merge commit and PR wording to identify the intended final outcome when available.
   - For each PR or topic, describe the final user-visible behavior after all follow-up commits in
     the range.
   - Collapse intermediate fixes, hardening, logging, and edge-case commits into the feature or fix
     they refine.
   - Prefer one changelog bullet or short paragraph per PR or coherent topic.
   - Split a PR into multiple entries only when it contains separate user-facing outcomes.
   - Do not list implementation chronology or transient states that were later changed in the same
     release range.
   - Mention implementation details only when they explain a user-visible capability,
     compatibility change, or operational requirement.
   - Add new version files at `changelogs/en/v<version>.md` and
     `changelogs/zh/v<version>.md`.
   - Start each file with `# v<version> (YYYY-MM-DD)`, followed by the release notes body.
   - Keep English and Chinese content semantically aligned.
   - Group entries by user-facing categories such as Features, Improvements, Fixes, and
     Engineering. Do not paste raw commit logs.
   - When a changelog entry summarizes work merged through one or more pull requests, append the PR
     number(s), such as `(#16)` or `(#16, #20)`. Use merge commits in the release range to identify
     PR numbers.
   - When a PR description, merge commit, or commit message clearly indicates that an issue was
     closed, fixed, or resolved, include the issue reference alongside the PR number, such as
     `(#16, closes #12)`. Do not infer issue links without explicit evidence.

5. Ask the user to review the changelog.
   - Show the generated English and Chinese changelog summaries to the user, or point them to the
     exact files if the content is long.
   - Stop after writing the changelog and wait for the user to explicitly say to continue before
     running validation, committing, tagging, or pushing.
   - If the user requests changelog changes, update the changelog files and ask for review again.

6. Validate before tagging.
   - Run `pnpm lint`.
   - Run `pnpm --filter bridge-browser run build`.
   - When feasible for a release, run the platform release build to verify both `.vsix` and browser
     `.zip` artifacts are produced:
     - On Windows/PowerShell, run `.\build_release.ps1`.
     - In non-interactive Windows shells, set `$env:CI='true'` before running
       `.\build_release.ps1` so `pnpm install` will not require a TTY.
     - On macOS/Linux, or Git Bash environments with `zip` available, run `./build_release.sh`.
   - If any validation fails, fix it or report the blocker. Do not commit, tag, or push a failed
     release.

7. Commit the release changes.
   - Confirm the diff contains only intended release changes, such as version, changelog, or
     explicitly requested release workflow updates.
   - Commit with `chore: release <version>`.

8. Tag and push.
   - Create the tag on the release commit: `git tag <version>`.
   - Push the branch and tag: `git push origin main` and `git push origin <version>`.
   - The tag push triggers `.github/workflows/release.yml`, which builds release artifacts and
     creates or updates the GitHub Release using bilingual notes read from
     `changelogs/en/v<version>.md` and `changelogs/zh/v<version>.md`.

## Safety Rules

- Do not create or push a tag if either `changelogs/en/v<version>.md` or
  `changelogs/zh/v<version>.md` is missing or empty.
- Do not push if the working tree is dirty after the release commit.
- Do not amend or force-push release commits or tags unless the user explicitly instructs it.
- If a tag was pushed before the release workflow existed, use the `Release` workflow's manual
  dispatch with the existing tag instead of recreating the tag.
