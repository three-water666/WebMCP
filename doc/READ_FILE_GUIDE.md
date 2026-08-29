# read_file 设计说明

本文说明 `read_file` 内置工具的目标、参数语义、读取模型、输出保护和已知边界，方便开发者维护，也方便用户理解 AI 读取 workspace 文件时发生了什么。

## 背景

`read_file` 是 webcode 提供给 AI 的专用文件读取工具。它替代了用 `execute_command` 调 `cat`、`sed`、`nl` 等 shell 命令查看文件的做法，目标是让文件读取具备稳定的参数语义、必要时的结构化 metadata 和上下文保护。

早期版本的保护策略主要针对“未指定范围”的大文件读取：默认只返回前 400 行，超过 64KB 的文件只读取前 64KB 前缀。这个策略能避免上下文爆炸，但显式传入 `head`、`tail` 或 `start_line/end_line` 时不经过同一套输出限制，容易在误传大范围时返回过多内容。

优化后的目标是：

- 工具入参保持简单清晰。
- 默认读取和范围读取共用同一套输出保护。
- 截断只在真正发生时通过结果文本和 metadata 告知 AI。
- 大文件读取尽量流式处理，避免无意义地把完整文件读入内存。

## 工具定位

`read_file` 用于读取 workspace 内的 UTF-8 文本文件，也可读取 `.webcode/builtin-skills/...` 下的内置 Skill 只读虚拟文件。

适合：

- 查看源码、配置、文档。
- 根据 `search_code` 返回的行号读取上下文。
- 根据 Available Skills 中的 `skillFilePath` 读取内置或工作区 Skill。
- 读取文件开头或末尾。
- 在编辑前确认目标文件内容。

不适合：

- 搜索文件名：使用 `search_files`。
- 搜索文件内容：使用 `search_code`。
- 读取二进制文件、图片、PDF、压缩包；受支持的图片和 PDF 应使用 `attach_file`。
- 读取极大文件的完整内容。

## 参数语义

常用参数：

| 参数 | 说明 |
| --- | --- |
| `path` | 必填。workspace 相对文件路径，使用 `/` 分隔；不接受绝对路径、`~` home 路径或反斜杠。内置 Skill 可使用 `.webcode/builtin-skills/...` 只读虚拟路径。 |
| `head` | 可选。读取文件开头 N 行。 |
| `tail` | 可选。读取文件末尾 N 行。 |
| `start_line` | 可选。1-based 起始行，必须和 `end_line` 一起使用。 |
| `end_line` | 可选。1-based 结束行，包含该行，必须和 `start_line` 一起使用。 |
| `show_line_numbers` | 可选。返回文本中给每行加 `12: ` 形式的行号前缀。 |

互斥规则：

- `head` 和 `tail` 不能同时使用。
- `head` 或 `tail` 不能和 `start_line/end_line` 混用。
- `start_line` 和 `end_line` 必须成对出现。
- `start_line` 必须小于等于 `end_line`。

## 推荐用法

读取文件开头：

```json
{
  "path": "gateway-vscode/src/tools/readFileTool.ts",
  "head": 120,
  "show_line_numbers": true
}
```

读取文件末尾：

```json
{
  "path": "logs/app.log",
  "tail": 100
}
```

读取明确行号范围：

```json
{
  "path": "gateway-vscode/src/tools/readFileTool.ts",
  "start_line": 120,
  "end_line": 220,
  "show_line_numbers": true
}
```

## 读取模型

`read_file` 执行时先检查是否命中内置 Skill 虚拟路径；命中时直接读取内置内容，不访问 workspace 文件系统。其他路径会先用 `fs.stat` 获取文件大小，然后按参数选择读取路径。

### 无行选择参数

如果没有 `head`、`tail`、`start_line/end_line`：

- 文件不超过输出字节上限时，读取完整文件后统一做输出限制。
- 文件超过输出字节上限时，只读取前缀，再统一做输出限制。

前缀读取会处理 UTF-8 边界，避免在多字节字符中间截断。

### `head` 和 `start_line/end_line`

大文件会走正向流式读取：

- `head` 从第 1 行开始读到目标行数。
- `start_line/end_line` 从文件开头扫描到目标范围。
- 到达目标结束行后提前停止。

### `tail`

`tail` 需要知道文件末尾的最后 N 行，因此当前实现会流式扫描完整文件，只保留最近 N 行。

## 输出保护

`read_file` 对所有返回路径使用统一输出限制：

```text
最多 1000 行
最多 128KB 文本
```

只要输出超过任一限制，就会截断返回内容，并在文本末尾追加提示。

截断原因写入 metadata：

| `reason` | 含义 |
| --- | --- |
| `line_limit` | 超过最大返回行数。 |
| `byte_limit` | 超过最大返回字节数。 |
| `line_and_byte_limit` | 同时触发行数和字节限制。 |

这些限制是内部保护，不作为工具入参暴露。AI 如果需要更多内容，应使用更窄的 `start_line/end_line`、`head` 或 `tail` 分段读取。

## 返回 metadata

`read_file` 默认只返回文本内容。只有发生截断时，才通过 `structuredContent` 返回简短 metadata。

主要字段：

| 字段 | 说明 |
| --- | --- |
| `truncated` | 固定为 `true`，表示发生输出截断。 |
| `reason` | 截断原因。 |
| `lineCountKnown` | `lineCount` 是否可信。 |
| `lineCount` | 文件总行数，只有已知时返回。 |
| `returnedLines` | 实际返回的行号范围。 |
| `returnedBytes` | 截断时返回文本的字节数。 |
| `fileBytes` | 文件大小。 |

`lineCountKnown` 很重要：当工具只读取大文件前缀或提前停止流式扫描时，可能无法知道文件总行数。

未截断时不返回 `structuredContent`，避免 `read_file` 作为高频工具在上下文中反复制造重复 metadata。

## 行号行为

`show_line_numbers: true` 会在返回文本中给每行加 1-based 行号前缀，例如：

```text
12: const value = readConfig();
```

这个格式适合定位和代码审查，但不是文件原文。后续使用 `write_file` 或 `edit_file` 时不能把行号前缀写回文件。

## 实现拆分

相关实现位于：

- `gateway-vscode/src/tools/readFileTool.ts`：工具 schema、参数校验、metadata 和读取流程。
- `gateway-vscode/src/tools/readFileLineStream.ts`：按行流式读取 `head`、`tail`、范围。
- `gateway-vscode/src/tools/readFileOutputLimit.ts`：统一输出限制、截断原因和行号格式化。
- `gateway-vscode/src/tools/readFilePrefix.ts`：大文件前缀读取和 UTF-8 边界处理。

## 已知边界

- `read_file` 只按 UTF-8 文本处理文件，不做编码自动探测。
- `.webcode/builtin-skills/...` 是只读虚拟路径，只由 `read_file` 识别；不能写入、编辑、搜索或作为命令目录执行。
- `tail` 当前需要扫描完整文件，对超大日志会比正向范围读取更慢。
- `lineCount` 在前缀读取或提前停止的范围读取中可能未知。
- 输出限制会尽量保留完整行；如果单行超过字节上限，会截断该行文本。
- `show_line_numbers` 改变返回文本格式，不适合作为编辑原文直接使用。

## 后续可扩展方向

- 对 `tail` 增加反向分块读取，减少超大日志的扫描成本。
- 增加轻量文件画像工具或 metadata-only 模式，返回行数、最长行、是否疑似二进制等信息。
- 为 Markdown 或 TypeScript 文件提供可选 outline，帮助 AI 先了解文件结构再选择范围。
