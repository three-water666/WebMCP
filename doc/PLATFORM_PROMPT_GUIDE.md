# 平台差异化提示词指南

本文说明 webcode 如何为不同 AI 网站注入差异化提示词，以及后续给其他平台新增专属 prompt 时应该改哪些文件。

## 为什么需要平台差异化提示词

webcode 的公共初始化提示词负责说明本地 VS Code 工具、Available Tools 和 Available Skills。
JSON/XML 工具格式是独立资源，运行时只会根据站点 `toolProtocol` 拼接其中一种。

但不同 AI 网站会暴露不同的平台内置能力。例如 ChatGPT 可能会显示平台自带的 Python、canvas、`python_user_visible` 等可见工具。这些工具运行在 ChatGPT 平台环境里，不是用户本地 VS Code 工作区。模型如果在 webcode 任务中误用它们，可能会出现：

- 用平台 Python 读取不到用户本地项目，却误以为已经检查过。
- 调用 `python_user_visible` 输出 `noop`、占位文本或内部状态，用户会看到无意义内容。
- 打开 canvas 或类似平台工具，干扰本来应该通过 webcode 完成的本地代码任务。

平台差异化提示词的目的，是在公共提示词之外，为某个具体 AI 网站补充更针对性的行为约束。

## 当前实现概览

平台 prompt 现在由站点 `id` 关联，不再通过 URL 片段推导，也不再使用单独的 `platformId` 字段。

以 ChatGPT 为例：

1. [gateway-vscode/src/platforms.ts](../gateway-vscode/src/platforms.ts) 中定义内置站点 `id: 'chatgpt'`。
2. VS Code 从状态栏菜单打开 ChatGPT 时，bridge URL 会携带 `siteId=chatgpt`。
3. 浏览器 bridge 握手时，把 `siteId` 写入当前 tab 的 `session_<tabId>`。
4. background 异步请求 `/v1/init`，把 prompts 和 `syncedAiSites` 写入 `chrome.storage.local`。
5. ChatGPT 页面 content script 通过 `GET_STATUS` 拿到 `siteId: 'chatgpt'`。
6. content script 用 `siteId` 读取平台 prompt，并根据 `toolProtocol` 读取一种协议 prompt：
   - 中文：`platform_prompt_chatgpt_zh`
   - 英文：`platform_prompt_chatgpt_en`
   - JSON：`protocol_json_zh` / `protocol_json_en`
   - XML：`protocol_xml_zh` / `protocol_xml_en`
7. 最终按“公共 prompt、选中的协议 prompt、平台 prompt”拼接；不会把两种协议同时暴露给模型。

## 浏览器端下发字段

`/v1/init` 下发给浏览器的站点配置只包含：

```ts
{
  id: string;
  name: string;
  toolProtocol: 'json' | 'xml';
  selectors: SiteSelectors;
}
```

不会下发：

- `address`
- `showQuickLaunch`
- `browser`
- `platformId`

这些字段要么属于 VS Code 启动行为，要么已经被 `id/siteId` 取代。

## 相关文件

### 站点定义

[gateway-vscode/src/platforms.ts](../gateway-vscode/src/platforms.ts)

这里定义内置站点：

- `BuiltinPlatformId`
- `BUILTIN_AI_SITES`
- `id`
- `name`
- `address`
- `showQuickLaunch`
- `browser`
- `toolProtocol`
- `selectors`

平台 prompt 的关联键就是站点 `id`。

### 平台 prompt 源文件

[gateway-vscode/prompts/platforms/](../gateway-vscode/prompts/platforms/)

当前 ChatGPT prompt 文件：

- `chatgpt_zh.md`
- `chatgpt_en.md`

命名约定：

```text
<siteId>_zh.md
<siteId>_en.md
```

### prompt 打包和下发

[gateway-vscode/src/defaults.ts](../gateway-vscode/src/defaults.ts)

这里导入 markdown 文件，并把它们放进 `PROMPTS`：

```ts
platform_prompt_chatgpt_en
platform_prompt_chatgpt_zh
```

这些 key 会通过 `/v1/init` 下发给浏览器扩展。

### `/v1/init` 站点同步

[gateway-vscode/src/gateway/initRoutes.ts](../gateway-vscode/src/gateway/initRoutes.ts)

这里把已解析站点收窄成浏览器运行时需要的字段：

```ts
{
  id,
  name,
  toolProtocol,
  selectors
}
```

### 浏览器端读取和拼接

[bridge-browser/src/content/main.ts](../bridge-browser/src/content/main.ts)

这里通过 `GET_STATUS` 读取当前 tab session 的 `siteId`，再用 `siteId` 从 `syncedAiSites` 中找到 selectors。

[bridge-browser/src/content/prompt_resources.ts](../bridge-browser/src/content/prompt_resources.ts)

这里负责：

- 读取公共 prompt 资源。
- 读取 JSON 和 XML 协议 prompt 资源。
- 根据 `siteId + 语言` 生成平台 prompt storage key。
- 从 `chrome.storage.local` 读取平台 prompt。

[bridge-browser/src/content/init_context.ts](../bridge-browser/src/content/init_context.ts)

这里负责构建最终初始化提示词：

1. 公共 prompt。
2. `toolProtocol` 选中的 JSON 或 XML 协议 prompt。
3. 当前站点 prompt。
4. 项目规则。
5. 项目上下文。
6. Available Tools，固定使用 JSON Schema 作为只读工具定义目录。
7. Available Skills，固定使用 JSON 作为名称、说明和路径目录。
8. 当前协议的短提醒，放在上下文末尾再次强调工具调用必须使用对应的围栏代码块。

## prompt 存储位置

平台 prompt 和其他 prompt 一样，运行时存储在浏览器扩展的 `chrome.storage.local` 中。

Gateway `/v1/init` 返回的数据形如：

```json
{
  "syncedAiSites": [
    {
      "id": "chatgpt",
      "name": "ChatGPT",
      "toolProtocol": "json",
      "selectors": {}
    }
  ],
  "prompts": {
    "prompt_zh": "...",
    "prompt_en": "...",
    "protocol_json_zh": "...",
    "protocol_json_en": "...",
    "protocol_xml_zh": "...",
    "protocol_xml_en": "...",
    "platform_prompt_chatgpt_zh": "...",
    "platform_prompt_chatgpt_en": "..."
  }
}
```

浏览器后台脚本收到后会统一写入 `chrome.storage.local`。

## 没有平台 prompt 时会怎样

如果某个站点没有对应的 md 文件，或者 `chrome.storage.local` 中没有对应 key，初始化不会报错。

行为是：

- 继续拼接公共 `prompt_zh` 或 `prompt_en`。
- 继续按 `toolProtocol` 拼接唯一一种协议 prompt。
- 继续拼接项目规则、项目上下文、Available Tools 和 Available Skills。
- 不追加站点专属提示词。

平台 prompt 是可选增强，不是必需依赖。

## 多页面和多 VS Code 情况

### 同一个浏览器同时打开多个 AI 网页

每个已连接 tab 都有自己的 `session_<tabId>`。

因此：

- ChatGPT tab 保存自己的 `siteId: 'chatgpt'`。
- Gemini tab 保存自己的 `siteId: 'gemini'`。
- 构建初始化提示词时，各页面根据自己的 `siteId` 读取对应平台 prompt。

平台 prompt 不缓存在共享的页面状态里，而是按 key 从 `chrome.storage.local` 读取，所以不同页面不会因为切换站点而互相串用平台 prompt。

### 多个 VS Code 同时连接

工具执行会按 tab session 使用各自的 `port` 和 `token`。

需要注意的是，prompt 模板和 `syncedAiSites` 仍存储在浏览器扩展全局 `chrome.storage.local` 中。如果多个 VS Code 实例同时运行且版本或配置不同，最后一次 `/v1/init` 同步会覆盖全局 prompt 和站点配置。

## 如何给其他平台新增平台 prompt

下面以新增 `gemini` 平台 prompt 为例。

### 第一步：确认站点 id

打开 [gateway-vscode/src/platforms.ts](../gateway-vscode/src/platforms.ts)，确认目标站点已经有稳定 id：

```ts
{
  id: 'gemini',
  name: 'Gemini',
  address: 'https://gemini.google.com',
  ...
}
```

如果平台还不是内置站点，需要先按 [PLATFORM_GUIDE.md](PLATFORM_GUIDE.md) 增加内置站点支持，或者在 `webcodeGateway.aiSites` 中配置一个新的完整站点。

### 第二步：新增双语 md 文件

在 [gateway-vscode/prompts/platforms/](../gateway-vscode/prompts/platforms/) 下新增：

```text
gemini_zh.md
gemini_en.md
```

文件内容只写平台特有规则，不要重复公共 prompt 中已经说明的完整工具协议。

建议内容包括：

- 平台自带工具与 webcode 工具的边界。
- 哪些平台能力不应该在本地项目任务中使用。
- 只有什么明确场景下才允许使用平台内置能力。
- 与该平台已知误行为相关的短规则。

### 第三步：在 defaults.ts 中导入并下发

打开 [gateway-vscode/src/defaults.ts](../gateway-vscode/src/defaults.ts)，新增导入：

```ts
import geminiPlatformPromptEn from '../prompts/platforms/gemini_en.md';
import geminiPlatformPromptZh from '../prompts/platforms/gemini_zh.md';
```

然后加入 `PLATFORM_PROMPTS`：

```ts
const PLATFORM_PROMPTS = {
  [`${PLATFORM_PROMPT_KEY_PREFIX}chatgpt_en`]: applyBranding(chatgptPlatformPromptEn),
  [`${PLATFORM_PROMPT_KEY_PREFIX}chatgpt_zh`]: applyBranding(chatgptPlatformPromptZh),
  [`${PLATFORM_PROMPT_KEY_PREFIX}gemini_en`]: applyBranding(geminiPlatformPromptEn),
  [`${PLATFORM_PROMPT_KEY_PREFIX}gemini_zh`]: applyBranding(geminiPlatformPromptZh)
};
```

key 命名必须符合：

```text
platform_prompt_<siteId>_<lang>
```

其中 `<lang>` 当前是 `zh` 或 `en`。

`platform_prompt_` 前缀属于 gateway 和 bridge 之间的协议字段，当前由 `@webcode/shared` 中的 `PLATFORM_PROMPT_KEY_PREFIX` 统一定义。

### 第四步：验证

建议至少执行：

```powershell
pnpm --filter bridge-browser run build
pnpm --filter gateway-vscode run compile-tests
pnpm --filter gateway-vscode run test
pnpm --filter gateway-vscode run compile
pnpm lint
```

手工验证：

1. 启动 VS Code Gateway。
2. 从 VS Code 状态栏打开目标 AI 网站。
3. 确认浏览器扩展存储里 `session_<tabId>` 有正确 `siteId`。
4. 确认 `/v1/init` 已同步新 prompt key。
5. 在目标网站触发初始化。
6. 检查最终初始化文本中是否包含平台专属 md 内容。
7. 在其他 AI 网站触发初始化，确认不会拼接这个平台的 md。

## 编写平台 prompt 的建议

- 保持短而具体。
- 只写该平台特有的问题。
- 不要复制公共 prompt 的工具调用格式全文。
- 不要写和平台无关的通用编码规范。
- 如果是为了约束平台内置工具，尽量写出真实工具名。
- 如果某个工具只有在少数场景可用，要写清楚允许条件。

例如 ChatGPT 当前会明确点名 `python_user_visible`，因为它是平台自带的用户可见 Python 工具，容易被模型误用来输出 `noop` 或占位内容。
