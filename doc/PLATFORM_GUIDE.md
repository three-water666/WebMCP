# webcode 站点支持扩展指南

本文说明 webcode 当前如何支持 AI 站点，以及后续新增或覆盖站点时应该怎么做。

## 当前架构

站点定义由 VS Code 扩展统一管理，浏览器扩展只接收运行时需要的最小配置。

VS Code 端完整站点结构：

```ts
{
  id: string;
  name: string;
  address: string;
  showQuickLaunch?: boolean;
  browser?: string;
  toolProtocol: 'json' | 'xml';
  selectors: SiteSelectors;
}
```

浏览器端 `/v1/init` 实际收到的 `syncedAiSites` 只包含：

```ts
{
  id: string;
  name: string;
  toolProtocol: 'json' | 'xml';
  selectors: SiteSelectors;
}
```

字段职责：

- `id`
  - 站点唯一身份。
  - VS Code 启动 bridge 时会把它作为 `siteId` 传给浏览器扩展。
  - 浏览器 content script 用它选择 selectors 和平台专属 prompt。

- `address`
  - VS Code 端的启动地址。
  - Gateway `/bridge` 用它校验 `target` 是否属于选中的站点。
  - 不再下发给浏览器端，也不再用于 content script 根据当前 URL 猜站点。

- `showQuickLaunch`
  - 只影响 VS Code 状态栏菜单的主快速启动列表。
  - 浏览器扩展不需要这个字段。

- `browser`
  - 只影响 VS Code 启动该站点时选择哪个浏览器。
  - 浏览器扩展不需要这个字段。

- `toolProtocol`
  - 决定该站点提示模型使用 JSON 还是 XML 工具调用，并使用同样格式回填结果。
  - DeepSeek 内置默认值是 `xml`，其他内置站点默认是 `json`。
  - 每次初始化只拼接选中格式的协议提示，浏览器也只捕获和解析该格式。

- `selectors`
  - 浏览器 content script 操作网页所需的 DOM selectors。
  - 这是浏览器端站点配置里最核心的字段。

每个已连接 tab 的浏览器 session 会保存：

```ts
{
  port: number;
  token: string;
  workspaceId: string;
  showLog: boolean;
  siteId: string;
  targetOrigin: string;
  targetUrl: string;
}
```

`targetOrigin` 和 `targetUrl` 来自 bridge 握手时的跳转目标，立即可用，不依赖 `/v1/init`。URL 安全判断用它们确认当前 tab 是否还停留在原始 AI 站点范围内；如果跳转到登录页或其他不匹配 URL，session 会保留，但页面能力会暂停，直到回到安全 URL 后恢复。

## 内置站点与用户覆盖规则

`webcodeGateway.aiSites` 不是整份替换默认站点列表，而是覆盖或追加。

当前规则：

- 先加载内置默认站点。
- 用户配置里有 `id` 时，优先按 `id` 匹配内置站点。
- `id` 命中内置站点时，覆盖该内置站点的可配置字段，`selectors` 按字段合并。
- 用户配置没有 `id` 时，会按 `name` 匹配内置站点，这是旧配置兼容兜底。
- `id` 不命中内置站点时，作为新增自定义站点。
- 自定义站点必须提供完整 `selectors`，不会自动继承其他站点。
- 当前不支持通用继承字段；要么覆盖内置站点，要么新增完整站点。

## 方案 A：在代码里新增内置站点

适用场景：

- 这个站点应该默认出现在所有用户的快速启动列表里。
- 默认 selectors 希望跟随扩展版本维护。
- 站点需要平台专属 prompt 或长期支持。

主要修改 [gateway-vscode/src/platforms.ts](../gateway-vscode/src/platforms.ts)。

通常需要：

1. 在 `BuiltinPlatformId` 中加入新 id。
2. 在内置站点数组中新增完整站点定义。

示例：

```ts
export type BuiltinPlatformId =
  | 'chatgpt'
  | 'gemini'
  | 'aistudio'
  | 'deepseek'
  | 'glm';

const BUILTIN_AI_SITES: ResolvedAiSiteConfig[] = [
  {
    id: 'glm',
    name: 'GLM',
    address: 'https://chatglm.cn/',
    showQuickLaunch: true,
    selectors: {
      messageBlocks: '.answer-content-wrap',
      codeBlocks: 'pre code',
      inputArea: 'textarea.scroll-display-none',
      sendButton: '.enter.is-main-chat.m-three-row',
      stopButton: '.enter.is-main-chat.searching',
      maxInlineChars: 20000
    }
  }
];
```

## 方案 B：通过 VS Code 配置覆盖或新增站点

适用场景：

- 私有或实验性站点。
- 只想本地快速验证 selectors。
- 不需要所有用户默认可见。

配置项是 `webcodeGateway.aiSites`。

覆盖内置站点示例：

```json
{
  "webcodeGateway.aiSites": [
    {
      "id": "deepseek",
      "toolProtocol": "xml",
      "showQuickLaunch": false,
      "browser": "edge",
      "selectors": {
        "inputArea": "textarea.custom-input"
      }
    }
  ]
}
```

这个配置会保留 DeepSeek 内置 selectors，只覆盖 `inputArea`、`showQuickLaunch` 和 `browser`。

新增自定义站点示例：

```json
{
  "webcodeGateway.aiSites": [
    {
      "id": "my-private-ai",
      "name": "My Private AI",
      "address": "https://example.ai/chat",
      "showQuickLaunch": true,
      "browser": "default",
      "toolProtocol": "json",
      "selectors": {
        "messageBlocks": ".assistant-message",
        "codeBlocks": "pre code",
        "inputArea": "textarea",
        "sendButton": "button.send",
        "stopButton": "button.stop",
        "maxInlineChars": 20000
      }
    }
  ]
}
```

自定义站点没有内置默认值，`selectors` 必须完整。

## 运行时链路

从 VS Code 打开站点时：

1. 用户在 VS Code 状态栏菜单选择某个站点。
2. VS Code 打开 `/bridge?bridgeToken=...&siteId=<id>&target=<address>`。
3. Gateway 校验 `bridgeToken`、`siteId` 和 `target`；`target` 必须属于该站点的 `address`。
4. Gateway 在 bridge 页面里写入 VS Code 扩展版本。
5. 浏览器 bridge 页面从页面数据读取 token，再读取浏览器扩展版本，要求它和 VS Code 扩展版本完全一致。
6. 版本一致后，bridge 页面握手，把 `siteId`、`targetOrigin`、`targetUrl` 写进 `session_<tabId>`。
7. background 异步请求 `/v1/init`，把 prompts 和 `syncedAiSites` 写进 `chrome.storage.local`。
8. 目标 AI 页面里的 content script 通过 `GET_STATUS` 拿到 `siteId`。
9. content script 用 `siteId` 在 `syncedAiSites` 中查 selectors 和 `toolProtocol`。

这个设计避免了两个问题：

- content script 不再根据当前 URL 猜当前站点。
- URL 安全判断不依赖 `/v1/init` 是否已经完成，不会因为配置还没同步就误删 session；如果当前 URL 不安全，只会暂停页面能力，回到安全 URL 后恢复。

## 连接已有网页

浏览器 popup 里手动把当前网页绑定到已有 Gateway 的入口已移除。

原因是这个流程没有明确 `siteId`，会破坏“每个 session 都有站点身份”的模型。当前推荐流程是从 VS Code 状态栏菜单启动目标站点。

## selectors 字段说明

- `messageBlocks`
  - 模型或助手消息块。

- `codeBlocks`
  - 模型输出中的代码块。

- `inputArea`
  - 输入框元素。

- `sendButton`
  - 发送按钮。

- `stopButton`
  - 停止生成按钮。

- `maxInlineChars`
  - 可选最大内联字符阈值。
  - 超过阈值时可以切换到文件回传兜底。

selectors 建议：

- 优先使用稳定属性，不要依赖动态 class。
- 确保 `codeBlocks` 只命中模型输出，不命中用户输入区。
- 同时测试空闲状态和生成中状态。
- 检查登录、重定向、新会话、已有会话 URL。

## 验证建议

建议执行：

```powershell
pnpm --filter bridge-browser run build
pnpm --filter gateway-vscode run compile-tests
pnpm --filter gateway-vscode run test
pnpm --filter gateway-vscode run compile
pnpm lint
```

手工验证：

1. 从 VS Code 状态栏打开目标站点。
2. 确认 bridge 页面握手成功并跳转。
3. 确认浏览器扩展存储里 `session_<tabId>` 有 `siteId`、`targetOrigin`、`targetUrl`。
4. 确认 `/v1/init` 下发的 `syncedAiSites` 包含 `id/name/toolProtocol/selectors`。
5. 验证配置格式的工具调用能被捕获，另一格式不会被当作工具调用。
6. 验证工具结果按 `toolProtocol` 成功回填。
7. 验证自动发送正常。

## 常见坑

- `id` 写错
  - 覆盖内置站点时必须使用内置 id，例如 `chatgpt`。

- 自定义站点 selectors 不完整
  - 自定义站点不会继承其他站点，缺字段会导致 content script 无法启用。

- `address` 配到错误 origin
  - Gateway 会拒绝 `siteId` 和 `target` 不匹配的 bridge 请求。

- `targetUrl` path 过窄
  - 如果站点配置为特定 path，URL 安全判断只允许这个 path 及其子路径。

- 多个 VS Code 同时运行
  - 每个 tab 的工具执行按 session 的 `port/token` 走。
  - prompts 和 `syncedAiSites` 仍存储在浏览器扩展全局 `chrome.storage.local`，最后一次 `/v1/init` 会覆盖全局配置。

- VS Code 扩展版本和浏览器扩展版本不一致
  - bridge 页面会拒绝握手，不会创建 session。
  - 独立浏览器模式如果仍有旧浏览器进程在运行，可能继续使用旧 bridge；关闭所有独立浏览器窗口后重新从 VS Code 打开即可重新加载内置 bridge。
