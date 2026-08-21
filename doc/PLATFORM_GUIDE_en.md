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
  toolProtocol: 'json' | 'xml';
  selectors: SiteSelectors;
}
```

Browser `/v1/init` receives `syncedAiSites` in this narrower shape:

```ts
{
  id: string;
  name: string;
  toolProtocol: 'json' | 'xml';
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

- `toolProtocol`
  - Selects JSON or XML for model instructions and tool-result delivery.
  - Built-in DeepSeek defaults to `xml`; other built-in sites default to `json`.
  - Initialization includes only the selected protocol prompt, and the browser only captures that format.

- `selectors`
  - DOM selectors required by the browser content script.

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
- Matching entries override configurable fields; `selectors` are merged field by field.
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
9. The content script uses `siteId` to find selectors and `toolProtocol` in `syncedAiSites`.

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
4. Confirm `/v1/init` sends `id/name/toolProtocol/selectors` for `syncedAiSites`.
5. Verify configured-format calls, rejection of the other format, matching result delivery, and auto-send.

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
