import {
  isBackgroundRuntimeMessageRequest,
  isMessageRequest,
  type MessageRequest,
} from "../src/types";

type MessageByType = {
  [Type in MessageRequest["type"]]: Extract<MessageRequest, { type: Type }>;
};

const validMessages = {
  HANDSHAKE: {
    type: "HANDSHAKE",
    port: 43125,
    bridgeCode: "bridge-code",
    bridgeProtocolVersion: 1,
    vscodeExtensionVersion: "1.0.1",
    browserExtensionVersion: "1.0.1",
    force: false,
  },
  GET_STATUS: { type: "GET_STATUS", tabId: 42 },
  REQUEST_USER_ATTENTION: { type: "REQUEST_USER_ATTENTION", playSound: true },
  CLEAR_WINDOW_ATTENTION: { type: "CLEAR_WINDOW_ATTENTION" },
  EXECUTE_TOOL: {
    type: "EXECUTE_TOOL",
    payload: { name: "read_file", arguments: { path: "README.md" } },
    approvalToken: "approval-token",
  },
  PREFLIGHT_TOOL: {
    type: "PREFLIGHT_TOOL",
    payload: { name: "execute_command", arguments: { command: "git status" } },
  },
  APPROVE_TOOL: { type: "APPROVE_TOOL", challengeId: "challenge-id" },
  SHOW_NOTIFICATION: {
    type: "SHOW_NOTIFICATION",
    title: "Complete",
    message: "Task completed",
    onlyWhenWindowInBackground: true,
  },
  SYNC_CONFIG: { type: "SYNC_CONFIG" },
  SET_LOG_VISIBLE: { type: "SET_LOG_VISIBLE", tabId: 42, show: true },
  SET_AUTO_SEND: { type: "SET_AUTO_SEND", tabId: 42, autoSend: true },
  SET_AUTO_APPROVE_TOOLS: {
    type: "SET_AUTO_APPROVE_TOOLS",
    tabId: 42,
    autoApproveTools: true,
  },
  SET_DEFAULT_AUTO_APPROVE_TOOLS: {
    type: "SET_DEFAULT_AUTO_APPROVE_TOOLS",
    defaultAutoApproveTools: true,
  },
  MANUAL_INIT: { type: "MANUAL_INIT" },
  TOGGLE_LOG: { type: "TOGGLE_LOG", show: true },
  STATUS_UPDATE: {
    type: "STATUS_UPDATE",
    connected: true,
    siteId: "chatgpt",
    workspaceId: "workspace",
    autoSend: true,
    autoApproveTools: false,
  },
  LOG_VISIBLE_CHANGED: { type: "LOG_VISIBLE_CHANGED", tabId: 42, show: true },
  AUTO_SEND_CHANGED: { type: "AUTO_SEND_CHANGED", tabId: 42, autoSend: true },
  AUTO_APPROVE_TOOLS_CHANGED: {
    type: "AUTO_APPROVE_TOOLS_CHANGED",
    tabId: 42,
    autoApproveTools: true,
  },
  DEFAULT_AUTO_APPROVE_TOOLS_CHANGED: {
    type: "DEFAULT_AUTO_APPROVE_TOOLS_CHANGED",
    defaultAutoApproveTools: true,
  },
} satisfies MessageByType;

const backgroundMessageTypes = new Set<MessageRequest["type"]>([
  "HANDSHAKE",
  "GET_STATUS",
  "REQUEST_USER_ATTENTION",
  "CLEAR_WINDOW_ATTENTION",
  "EXECUTE_TOOL",
  "PREFLIGHT_TOOL",
  "APPROVE_TOOL",
  "SHOW_NOTIFICATION",
  "SYNC_CONFIG",
  "SET_LOG_VISIBLE",
  "SET_AUTO_SEND",
  "SET_AUTO_APPROVE_TOOLS",
  "SET_DEFAULT_AUTO_APPROVE_TOOLS",
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function main(): void {
  for (const message of Object.values(validMessages)) {
    assert(isMessageRequest(message), `valid ${message.type} message was rejected`);
    assert(
      isBackgroundRuntimeMessageRequest(message) === backgroundMessageTypes.has(message.type),
      `${message.type} was assigned to the wrong runtime destination`
    );
  }

  const invalidMessages: unknown[] = [
    null,
    {},
    { type: "UNKNOWN" },
    { ...validMessages.HANDSHAKE, port: "43125" },
    { type: "GET_STATUS", tabId: "42" },
    { type: "EXECUTE_TOOL", payload: { arguments: {} } },
    { type: "PREFLIGHT_TOOL", payload: { name: "execute_command", arguments: [] } },
    { type: "APPROVE_TOOL" },
    { type: "SHOW_NOTIFICATION", onlyWhenWindowInBackground: "yes" },
    { type: "SET_AUTO_SEND", tabId: 42 },
    { type: "STATUS_UPDATE", connected: "yes" },
    { type: "LOG_VISIBLE_CHANGED", tabId: 42, show: "yes" },
  ];

  for (const message of invalidMessages) {
    assert(!isMessageRequest(message), `invalid message was accepted: ${JSON.stringify(message)}`);
  }

  const handshake: MessageRequest = validMessages.HANDSHAKE;
  assert(handshake.type === "HANDSHAKE" && handshake.port === 43125, "handshake narrowing failed");
  console.log("PASS validates and narrows runtime message requests");
}

main();
