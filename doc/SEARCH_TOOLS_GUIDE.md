# search_files 与 search_code 设计说明

本文说明 `search_files` 和 `search_code` 两个内置搜索工具的目标、参数语义、底层实现和已知边界，方便开发者维护，也方便用户理解 AI 在 workspace 中查找文件和代码时发生了什么。

## 背景

webcode 早期的文件查找和代码查找采用了两套不同实现：

- `search_files` 基于 VS Code `workspace.findFiles`，先用 query 生成 include glob，再做二次过滤。
- `search_code` 基于 ripgrep 搜索文件内容，并在 ripgrep 不可用时使用进程内 fallback。

这会导致 `search_files` 在一些场景下不够稳定。例如用户输入 `webfetch`，实际目录叫 `WebFetchTool`，二次过滤虽然不区分大小写，但 VS Code include glob 阶段可能已经没有把候选文件取回来。

优化后的目标是：

- 文件搜索和代码搜索都优先复用 ripgrep。
- 工具参数表达清晰，不暴露 shell 命令和跨平台 quoting 细节。
- 搜索结果不因是否安装了 ripgrep 而改变语义。
- 默认限制输出量，避免一次搜索占满模型上下文。

## 工具定位

### search_files

`search_files` 用于按文件名或 workspace 相对路径查找文件。它不读取文件内容，只返回匹配文件路径。

适合：

- 不确定文件准确路径时先定位文件。
- 查找某类文件，例如测试文件、配置文件、组件文件。
- 列出某个目录下可读文件。
- 在编辑或读取前确认目标路径。

### search_code

`search_code` 用于搜索文件内容。它返回 workspace 相对路径、行号和命中行。

适合：

- 查找函数、变量、配置项、错误信息等文本。
- 根据入口关键词追踪调用链。
- 在读取大文件前先定位相关行号。
- 搜索打包后或长文件中的关键片段。

## search_files 参数语义

常用参数：

| 参数 | 说明 |
| --- | --- |
| `path` | 搜索根目录，默认 `.`。必须是 workspace 相对目录，使用 `/` 分隔。 |
| `query` | 文件名或相对路径查询，默认 `*`，表示列出 `path` 下文件。 |
| `match` | query 解释方式：`auto`、`substring`、`glob`，默认 `auto`。 |
| `case_sensitive` | 是否区分大小写，默认 `false`。 |
| `max_results` | 最多返回多少个匹配文件，默认 200。达到上限时输出会提示结果已被限制。 |

### path

`path` 是搜索根目录，不是匹配条件。

示例：

```json
{
  "path": "gateway-vscode/src/tools",
  "query": "*"
}
```

这表示列出 `gateway-vscode/src/tools` 下符合规则的文件。

支持：

- `.`：workspace 根目录。
- `gateway-vscode/src/tools`：workspace 相对目录。

不支持：

- 绝对路径或 `~` home 路径。
- 反斜杠路径，例如 `gateway-vscode\src`。
- 多个目录。
- `|` 分隔目录。
- glob 目录，例如 `src/**`。
- 指向文件的路径。

### query

`query` 是文件名或相对路径匹配条件。未提供或为空时等价于 `*`。

`query: "*"` 表示列出文件，不是普通星号字符。

`query: "."` 只是字面量点号，通常会匹配带扩展名的文件，但不等价于当前目录。

`query: "foo|bar"` 中的 `|` 不表示 OR，只是普通字符。简单多选应使用 glob brace，例如 `*{foo,bar}*`。

## search_files match 模式

### auto

默认模式。规则是：

- query 含 `*`、`?`、`{`、`}` 时按 glob 解释。
- 其他情况按普通子串解释。

示例：

```json
{
  "query": "searchFiles"
}
```

按普通子串搜索。

```json
{
  "query": "**/*.test.ts"
}
```

按 glob 搜索。

### substring

强制把 query 当普通字面子串。不会解释 `*`、`?`、`{}`。

示例：

```json
{
  "query": "WebFetch",
  "match": "substring"
}
```

默认不区分大小写，因此也能匹配 `webfetch`、`WEBFETCH` 等大小写变体。

### glob

强制把 query 当 glob。

常见示例：

| query | 含义 |
| --- | --- |
| `*` | 匹配所有文件。 |
| `*.ts` | 匹配当前搜索根下所有 `.ts` 文件，实际对文件名也会匹配。 |
| `**/*.test.ts` | 匹配所有测试文件。 |
| `src/**/*.ts` | 匹配 `src` 下所有层级的 `.ts` 文件。 |
| `*.{ts,tsx}` | 匹配 `.ts` 或 `.tsx` 文件。 |
| `*{foo,bar}*` | 匹配路径或文件名中包含 `foo` 或 `bar` 的文件。 |

## search_code 参数语义

常用参数：

| 参数 | 说明 |
| --- | --- |
| `path` | 搜索根目录，默认 `.`。必须是 workspace 相对目录，使用 `/` 分隔。 |
| `query` | 要搜索的文本。 |
| `match` | query 解释方式：`substring` 或 `regex`，默认 `substring`。 |
| `include` | 可选 include glob，例如 `**/*.ts`。 |
| `case_sensitive` | 是否区分大小写，默认 `false`。 |
| `max_results` | 最多返回多少条命中行，默认 100。达到上限时输出会提示结果已被限制。 |
| `max_line_chars` | 每条命中行最多返回多少字符，默认 500。 |

`search_code` 不再使用 `use_regex`。是否启用正则只由 `match` 控制。

## search_code match 模式

### substring

默认模式。query 按字面文本做“包含匹配”。

示例：

```json
{
  "query": "preventDefault"
}
```

可以命中：

```ts
event.preventDefault();
```

在该模式下：

- `.` 是普通点号。
- `|` 是普通竖线。
- `*` 是普通星号。
- `(`、`)`、`[`、`]` 都是普通字符。
- 如果 query 写了 `|`、`.*`、分组、字符类、`\b` 等正则语法，必须传 `match: "regex"`。

### regex

`match: "regex"` 时，query 按 ripgrep 正则表达式解释。

示例：

```json
{
  "query": "preventDefault|stopPropagation",
  "match": "regex"
}
```

可以匹配 `preventDefault` 或 `stopPropagation`。

更多示例：

| query | 含义 |
| --- | --- |
| `function\\s+\\w+` | 匹配函数声明片段。 |
| `search_(files|code)` | 匹配 `search_files` 或 `search_code`。 |
| `\\btool_name\\b` | 匹配完整词 `tool_name`。 |

注意：ripgrep 可用时使用 ripgrep 正则；ripgrep 不可用时 fallback 使用 JavaScript `RegExp`。两者在少数高级正则语法上可能不完全一致。

## 大小写规则

两个搜索工具默认都不区分大小写：

```json
{
  "query": "webfetch"
}
```

可以匹配 `WebFetchTool`。

需要严格大小写时传：

```json
{
  "query": "WebFetch",
  "case_sensitive": true
}
```

## ignore 与 .git 规则

两个搜索工具不维护普通目录的内置排除列表。`node_modules`、`dist`、`build`、`coverage` 等目录是否被搜索，取决于项目的 ignore 文件、当前 `path` 和搜索条件。

两个工具也不提供额外排除参数。结果过多时，应优先收紧正向范围：

- `search_files`：细化 `path`、`query` 或 `match`。
- `search_code`：细化 `path`、`query`、`include` 或 `match`。

### .git 元数据

`.git` 是唯一的内部硬排除。两个工具都会跳过仓库元数据目录，包括 workspace 根目录下的 `.git` 和嵌套仓库的 `.git`。

即使把 `path` 直接指向 `.git`，搜索结果也不会返回 `.git` 元数据文件。

### rg ignore 文件行为

`.gitignore`、`.ignore`、`.rgignore` 是 ripgrep/git 的 ignore 机制。两个搜索工具默认都尊重 ignore 文件：

> **行为变更**：`search_files` 现在默认尊重 ignore 文件。以前能直接搜到的 `dist/`、`.env` 等被 ignore 文件，可能需要已知路径后用 `read_file` 读取，或把 `path` 指向更具体的目录。

| 工具 | ripgrep ignore 行为 | 原因 |
| --- | --- | --- |
| `search_files` | 使用 ripgrep 默认 ignore 行为，会尊重 `.gitignore`、`.ignore`、`.rgignore` 等。 | 文件发现结果更贴近日常源码阅读，避免优先返回缓存、生成物或依赖产物。 |
| `search_code` | 使用 ripgrep 默认 ignore 行为，会尊重 `.gitignore`、`.ignore`、`.rgignore` 等。 | 内容搜索更容易扫到大量生成文件或依赖源码，默认遵守项目 ignore 更稳。 |

因此：

- 想“发现文件是否存在”，优先用 `search_files`。
- 想“搜索被 ignore 文件的内容”，如果已知路径，优先用 `read_file` 直接读取。
- 想看依赖源码，把 `path` 直接设置到具体库目录，例如 `node_modules/react`。

## ripgrep 与 fallback

两个工具都优先使用 ripgrep。ripgrep 发现顺序是：

1. `webcodeGateway.ripgrep.path` 用户配置。
2. VS Code bundled ripgrep。
3. PATH 中的 `rg`。

如果 ripgrep 启动失败：

- `search_code` 使用进程内文本扫描 fallback。
- `search_files` 优先用 `git ls-files --cached --others --exclude-standard` fallback；如果 git 不可用，再使用 workspace 文件遍历 fallback。

fallback 的目标是保持工具可用，但速度和能力可能弱于 ripgrep。`search_files` 的 git fallback 会尊重 git ignore 规则；最终的文件遍历 fallback 不解析 ignore 文件，只跳过 `.git` 元数据目录。

## search_files 与 .gitignore

`search_files` 的 ripgrep 文件枚举使用 ripgrep 默认 ignore 行为。这意味着它会依赖 `.gitignore`、`.ignore`、`.rgignore` 或全局 ignore 文件决定候选列表。

如果 ripgrep 不可用，`search_files` 会优先使用 git 枚举文件：

```text
git ls-files --cached --others --exclude-standard
```

这会返回 tracked 文件和未被 git ignore 的 untracked 文件，并排除 `.gitignore`、`.git/info/exclude` 和全局 git ignore 命中的文件。

因此 `search_files` 的默认文件可见性是：

```text
workspace 范围 + ignore 文件 + .git 元数据排除
```

如果 ripgrep 和 git 都不可用，最终会退回 workspace 文件遍历。这个最后兜底路径不解析 ignore 文件，只跳过 `.git` 元数据目录。

## 输出格式

### search_files

返回匹配文件的 workspace 相对路径，每行一个：

```text
gateway-vscode/src/tools/searchFilesTool.ts
gateway-vscode/src/unit-test/searchFilesTool.test.ts
```

结果按 workspace 相对路径排序。

无匹配时，会返回搜索参数摘要和常见误用提示。例如：

```text
No matches found.
Searched path: .
Query: .
Match: auto (substring)
Case sensitive: false
Hint: query "." matches a literal dot. Use query "*" to list files.
```

达到 `max_results` 上限时，结果末尾会提示可能还有更多结果。例如：

```text
[search_files] Results limited to 200 file(s). There may be more results. Narrow query/path or raise max_results.
```

### search_code

返回格式是：

```text
relative/path.ts:123: matching line text
```

结果按 workspace 相对路径排序，同一文件内按行号升序返回。

长行会围绕命中位置截断，并提示省略字符数量，避免大文件或打包文件撑爆上下文。

达到 `max_results` 上限时，结果末尾会提示可能还有更多结果。例如：

```text
[search_code] Results limited to 100 match(es). There may be more results. Narrow query/path/include or raise max_results.
```

无匹配时，如果 query 看起来像正则但当前是默认 substring 模式，输出会附带提示：

```text
No matches found.
Hint: query looks like a regular expression. Did you mean to set match: "regex"?
```

## 推荐使用方式

先用 `search_files` 定位文件，再用 `read_file` 读取：

```json
{
  "query": "searchFilesTool",
  "match": "substring"
}
```

找到文件后：

```json
{
  "path": "gateway-vscode/src/tools/searchFilesTool.ts",
  "start_line": 1,
  "end_line": 120,
  "show_line_numbers": true
}
```

先用 `search_code` 定位行号，再用 `read_file` 读取上下文：

```json
{
  "query": "createRipgrepFilesArgs",
  "match": "substring"
}
```

然后按返回行号读取附近范围。

## 已知边界

- `search_code` 当前只返回命中行，不返回前后文。需要上下文时继续用 `read_file` 按行号读取。
- `search_files` 暂不支持 `queries: []` 多 query 字段。简单 OR 可用 glob brace，例如 `*{foo,bar}*`。
- `path` 只支持单个目录，不支持多目录或 glob 目录。
- `search_code` fallback 会跳过过大的文件和二进制文件，能力弱于 ripgrep。
- `search_code` 正则 fallback 使用 JavaScript `RegExp`，和 ripgrep 正则存在少数语法差异。

## 后续可扩展方向

- 给 `search_code` 增加 `context_lines`，直接返回命中行前后文。
- 给 `search_files` 增加 `queries`，支持多个查询条件，不依赖 glob brace。
- 增加更结构化的返回内容，例如总候选数、是否截断、实际匹配模式。
- 为 `search_code` 正则模式补充更多 ripgrep 与 fallback 差异测试。
