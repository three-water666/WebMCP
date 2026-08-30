---
name: release-package
description: 自动执行 webcode 发版流程。适用于用户要求发布新的 webcode 包或版本，提到“发新的包”“发布新版本”“打版本”“发版”或“release a new package”，或者要求更新版本号、生成变更日志、提交、打标签并推送，以便由标签触发的 GitHub Actions 发版工作流发布产物。
---

# WebCode 发版

语言：中文 | [English](SKILL_en.md)

## 工作流

除非用户明确要求提前停止，否则按以下顺序完整执行。

1. 确定目标版本。
   - 如果用户提供了版本号，直接使用该版本号。
   - 如果没有提供，根据最高的本地 semver 标签或当前发布包版本推断下一个补丁版本，
     并在编辑前说明这一假设。
   - 使用 `0.6.3` 这样的纯 semver 标签，以符合本仓库现有的标签约定。
     除非用户明确要求，否则不要使用 `v0.6.3`。

2. 执行发版前检查。
   - 检查 `git status --short`；如果存在无关改动，停止并询问用户。
   - 使用 `git tag --list <version>` 检查目标标签是否已经存在；
     绝对不要覆盖或移动已有的发版标签。
   - 使用 `git tag --list --sort=-v:refname` 确定上一个发版标签。

3. 更新发版版本号。
   - 更新 `gateway-vscode/package.json`。
   - 更新 `bridge-browser/package.json`。
   - 更新 `bridge-browser/manifest.json`。
   - 除非用户明确要求，否则不要修改根目录 `package.json` 或
     `shared/package.json` 的版本；它们不是本仓库的发版产物版本。

4. 生成变更日志条目。
   - 将提交历史视为素材来源，而不是变更日志的结构。
   - 查看 `git log --oneline <previous-tag>..HEAD`；如果相关，也要查看当前的发版版本改动。
   - 优先按已合并的 PR 对提交分组；对于不属于 PR 的提交，再按连贯的独立主题分组。
   - 如果有合并提交和 PR 文案，使用它们来判断预期的最终结果。
   - 对于每个 PR 或主题，描述该范围内所有后续提交完成后，用户最终能够看到的行为。
   - 将中间修复、加固、日志和边缘情况提交归并到它们所完善的功能或修复中。
   - 每个 PR 或连贯主题优先使用一个变更日志项目符号或短段落。
   - 只有当一个 PR 包含相互独立的用户可见结果时，才将它拆成多个条目。
   - 不要罗列实现时间线，也不要记录同一发版范围内后来又被更改的临时状态。
   - 只有当实现细节能够解释用户可见能力、兼容性变化或运维要求时，才提及它。
   - 在 `changelogs/en/v<version>.md` 和 `changelogs/zh/v<version>.md`
     新建对应版本文件。
   - 每个文件都以 `# v<version> (YYYY-MM-DD)` 开头，随后写入发版说明正文。
   - 保持英文和中文内容的语义一致。
   - 按面向用户的类别组织条目，例如功能（Features）、改进（Improvements）、
     修复（Fixes）和工程（Engineering）。不要直接粘贴原始提交日志。
   - 当变更日志条目概括了通过一个或多个拉取请求合并的工作时，在条目末尾附上 PR 编号，
     例如 `(#16)` 或 `(#16, #20)`。使用发版范围内的合并提交识别 PR 编号。
   - 如果 PR 描述、合并提交或提交信息明确指出某个议题已被关闭、修复或解决，
     请在 PR 编号旁加入议题引用，例如 `(#16, closes #12)`。
     没有明确证据时，不要推断议题关联。

5. 请用户审阅变更日志。
   - 向用户展示生成的英文和中文变更日志摘要；如果内容较长，则指出确切的文件路径。
   - 写完变更日志后停止，等待用户明确表示继续，然后才能执行验证、提交、打标签或推送。
   - 如果用户要求修改变更日志，更新对应文件并再次请用户审阅。

6. 打标签前进行验证。
   - 运行 `pnpm lint`。
   - 运行 `pnpm --filter bridge-browser run build`。
   - 如果发版条件允许，运行当前平台的发版构建，确认能够同时产出 `.vsix`
     和浏览器 `.zip` 产物：
     - 在 Windows/PowerShell 上，运行 `.\build_release.ps1`。
     - 在非交互式 Windows shell 中，先设置 `$env:CI='true'`，再运行
       `.\build_release.ps1`，避免 `pnpm install` 请求 TTY。
     - 在 macOS/Linux 或提供 `zip` 的 Git Bash 环境中，运行 `./build_release.sh`。
   - 如果任何验证失败，修复问题或报告阻塞原因。不要提交、打标签或推送失败的发版。

7. 提交发版改动。
   - 确认差异只包含预期的发版改动，例如版本、变更日志或用户明确要求的发版流程更新。
   - 使用 `chore: release <version>` 作为提交信息。

8. 打标签并推送。
   - 在发版提交上创建标签：`git tag <version>`。
   - 推送分支和标签：`git push origin main` 和 `git push origin <version>`。
   - 推送标签会触发 `.github/workflows/release.yml`。该工作流构建发版产物，
     并使用从 `changelogs/en/v<version>.md` 和 `changelogs/zh/v<version>.md`
     读取的双语说明来创建或更新 GitHub Release。

## 安全规则

- 如果 `changelogs/en/v<version>.md` 或 `changelogs/zh/v<version>.md`
  缺失或为空，不要创建或推送标签。
- 如果发版提交完成后工作树仍有未提交改动，不要推送。
- 除非用户明确指示，否则不要修改已有提交或强制推送发版提交或标签。
- 如果标签在发版工作流存在之前就已经推送，请使用 `Release` 工作流的手动触发功能
  和现有标签，不要重新创建该标签。
