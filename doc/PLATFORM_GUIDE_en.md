# webcode Site Support Guide

This document describes how webcode supports AI sites and how to add or override a site.

## Current Architecture

The VS Code extension owns the full site registry. The browser extension receives only the runtime fields it needs.

Resolved VS Code site shape:

```ts
{
  id: string;
  name: string;
  address: string;
  showQuickLaunch?: boolean;
  browser?: string;
  capture?: SiteNetworkCaptureConfig;
  selectors: SiteSelectors;
}
```

Browser `/v1/init` receives `syncedAiSites` in this narrower shape:

```ts
{
  id: string;
  name: string;
  capture?: SiteNetworkCaptureConfig;
  selectors: SiteSelectors;
}
```

Field responsibilities:

- `id`
  - Stable site identity.
  - VS Code passes it to the bridge as `siteId`.
  - The content script uses it to pick selectors and platform-specific prompts.

- `address`
  - VS Code launch URL.
  - The gateway validates that the bridge `target` belongs to this address.
  - It is not sent to the browser runtime and is not used by the content script to guess the site.

- `showQuickLaunch`
  - VS Code menu field only.

- `browser`
  - VS Code launch field only.

- `selectors`
  - DOM selectors required by the browser content script.

- `capture`
  - Optional network-response capture for tool calls that are absent from or collapsed in the DOM.
  - `/v1/init` syncs the declaration, but it can only select transports, strategies, and adapters
    bundled with the extension. It cannot download or execute parser code.
  - Selectors remain necessary for delivering tool results and submitting the follow-up message.

Each connected tab stores a browser session:

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

`targetOrigin` and `targetUrl` are written during the bridge handshake, before `/v1/init` completes. URL safety checks use these session fields to confirm whether the tab is still within the original AI site range; if the tab navigates to a sign-in provider or another non-matching URL, the session is kept but page capabilities are paused until the tab returns to a safe URL.

## Built-In Sites and User Overrides

`webcodeGateway.aiSites` overlays the built-in registry instead of replacing it.

Rules:

- Built-in sites are loaded first.
- User entries with `id` match built-in sites by `id`.
- Matching entries override configurable fields; `selectors` and `capture` are merged field by field.
- Entries without `id` can still match built-ins by `name` for compatibility with older configs.
- Unknown `id` values add custom sites.
- Custom sites must provide complete `selectors`.
- There is no general inheritance model. A config entry either overrides a built-in site or defines a complete new site.

## Option A: Add a Built-In Site

Use this when the site should be available to all users by default or needs maintained built-in selectors.

Update [gateway-vscode/src/platforms.ts](../gateway-vscode/src/platforms.ts):

1. Add the id to `BuiltinPlatformId`.
2. Add a complete item to the built-in site array.

Example:

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

## Option B: Override or Add a Site in VS Code Settings

Use `webcodeGateway.aiSites`.

Override a built-in site:

```json
{
  "webcodeGateway.aiSites": [
    {
      "id": "deepseek",
      "showQuickLaunch": false,
      "browser": "edge",
      "selectors": {
        "inputArea": "textarea.custom-input"
      }
    }
  ]
}
```

Add a custom site:

```json
{
  "webcodeGateway.aiSites": [
    {
      "id": "my-private-ai",
      "name": "My Private AI",
      "address": "https://example.ai/chat",
      "showQuickLaunch": true,
      "browser": "default",
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

Custom sites do not inherit defaults, so the selector set must be complete.

## Runtime Flow

1. The user picks a site from the VS Code status bar menu.
2. VS Code opens `/bridge?bridgeToken=...&siteId=<id>&target=<address>`.
3. The gateway validates `bridgeToken`, `siteId`, and `target`; `target` must belong to the selected site.
4. The gateway writes the VS Code extension version into the bridge page data.
5. The browser bridge reads the token from page data, then compares that version with the browser extension manifest version.
6. If the versions match, the handshake stores `siteId`, `targetOrigin`, and `targetUrl` in `session_<tabId>`.
7. The background script fetches `/v1/init` and writes prompts plus `syncedAiSites` to `chrome.storage.local`.
8. The target page content script calls `GET_STATUS` to get `siteId`.
9. The content script uses `siteId` to find selectors and optional capture settings in `syncedAiSites`.

This avoids URL guessing in the content script and avoids a race where URL safety depends on `/v1/init` finishing first. It also prevents sessions from being removed just because config has not synced yet; if the current URL is unsafe, page capabilities are paused and resume after the tab returns to a safe URL.

## Existing-Page Attach Flow

The popup flow that attached the current page to an existing gateway session has been removed.

That flow did not have an explicit `siteId`, which conflicts with the current session identity model. Start sites from the VS Code status bar menu instead.

## Selector Fields

- `messageBlocks`: assistant/model message containers.
- `codeBlocks`: code elements inside assistant output.
- `inputArea`: prompt input element.
- `sendButton`: send button.
- `stopButton`: stop-generation button.
- `maxInlineChars`: optional inline result size threshold.

Selector tips:

- Prefer stable attributes over generated classes.
- Ensure `codeBlocks` does not match user input.
- Test idle and generating states.
- Check login redirects, new conversations, and existing conversations.

## Network Response Capture

Network capture runs alongside the existing DOM scanner. The built-in ChatGPT configuration matches the
EventStream returned by `POST https://chatgpt.com/backend-api/f/conversation` and uses the
`chatgpt-delta-v1` adapter to reconstruct `commentary` messages:

This path requires Chromium 111 or later for the static `MAIN`-world content script.

```json
{
  "capture": {
    "enabled": true,
    "strategy": "network-preferred",
    "transport": "fetch-sse",
    "method": "POST",
    "url": "https://chatgpt.com/backend-api/f/conversation",
    "adapter": "chatgpt-delta-v1",
    "channels": ["commentary"]
  }
}
```

The built-in DeepSeek configuration uses `xhr-sse` for
`POST https://chat.deepseek.com/api/v0/chat/completion`. Its `deepseek-chat-v0` adapter reconstructs only
visible `RESPONSE` fragments. It always excludes `THINK` fragments so a tool call mentioned during reasoning
cannot execute before the model potentially emits it again in the final response.

Runtime rules:

- A main-world script wraps `window.fetch` and `XMLHttpRequest` at `document_start`. The fetch path leaves the
  original `Response` untouched and reads only a clone; the XHR path incrementally reads the existing
  `responseText`.
- Only the configured URL, HTTP method, and `text/event-stream` responses match. URL query parameters are
  ignored during matching.
- The adapter reconstructs deltas across SSE chunks, including tool-call JSON split across chunks.
- Tool calls are committed only after the response and protocol complete successfully. Incomplete, failed,
  or removed messages are discarded.
- Once a network turn starts, DOM capture for that turn is suppressed to avoid duplicate execution. A miss
  or capture failure falls back to the DOM path.
- A per-page random token correlates and filters messages between the page and isolated content script. Only
  extracted tool-call JSON candidates cross that boundary.
- Raw streams, hidden commentary/reasoning text, request headers, and credentials are not sent to the content
  script or gateway and are not persisted.

`capture` is declarative rather than a general network script. Supporting another stream protocol requires
shipping an adapter in the browser extension before selecting its name in platform configuration. Disable
a built-in capture temporarily by overriding its site id, for example:

```json
{
  "webcodeGateway.aiSites": [
    {
      "id": "chatgpt",
      "capture": {
        "enabled": false
      }
    }
  ]
}
```

## Verification

Recommended commands:

```powershell
pnpm --filter bridge-browser run build
pnpm --filter gateway-vscode run compile-tests
pnpm --filter gateway-vscode run test
pnpm --filter gateway-vscode run compile
pnpm lint
```

Manual checks:

1. Launch the site from VS Code.
2. Confirm the bridge redirects successfully.
3. Confirm `session_<tabId>` has `siteId`, `targetOrigin`, and `targetUrl`.
4. Confirm `/v1/init` sends only `id/name/selectors` and optional `capture` for `syncedAiSites`.
5. On capture-enabled sites, verify complete hidden or withdrawn calls are captured and failed streams do not run.
6. Verify DOM calls are not executed a second time through network capture.
7. Verify tool-result delivery and auto-send.

## Common Pitfalls

- Wrong `id`
  - Built-in overrides must use the built-in id, such as `chatgpt`.

- Incomplete custom selectors
  - Custom sites do not inherit defaults.

- Wrong `address` origin
  - The gateway rejects mismatched `siteId` and `target` values.

- Overly narrow `targetUrl` path
  - If a site address includes a path, URL safety allows only that path and its children.

- Multiple VS Code instances
  - Tool execution uses each tab session's `port/token`.
  - Prompts and `syncedAiSites` are still global browser-extension storage; the latest `/v1/init` wins.

- VS Code extension and browser extension versions differ
  - The bridge page rejects the handshake and no session is created.
  - In isolated browser mode, an already-running browser process may keep using the old bundled bridge. Close all isolated browser windows and launch from VS Code again to load the current bundled bridge.
