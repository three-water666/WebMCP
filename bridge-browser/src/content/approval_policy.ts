import {
  getCommandExecutable,
  getCommandPrefix,
  isCommandApprovalScopeAllowed,
  normalizeCommandValue,
  type CommandApprovalScope,
} from "../modules/command_approval";
import type { ToolExecutionPayload } from "../types";

const COMMAND_APPROVAL_TOOLS = new Set(["execute_command", "run_in_terminal"]);
const COMMAND_RULE_PREFIXES = ["command-exact:", "command-executable:", "command-prefix:"];

export interface ApprovalState {
  allowedTools: Set<string>;
  allowedCommandRules: Set<string>;
}

export function createApprovalState(): ApprovalState {
  return {
    allowedTools: new Set<string>(),
    allowedCommandRules: new Set<string>(),
  };
}

export function parseStoredApprovalEntries(rawEntries: unknown): ApprovalState {
  const approvalState = createApprovalState();
  if (!Array.isArray(rawEntries)) {
    return approvalState;
  }

  for (const entry of rawEntries) {
    if (typeof entry !== "string") {continue;}
    const normalizedEntry = normalizeStoredApprovalEntry(entry);
    if (!normalizedEntry) {continue;}
    if (isCommandRuleEntry(normalizedEntry)) {
      approvalState.allowedCommandRules.add(normalizedEntry);
    } else {
      approvalState.allowedTools.add(normalizedEntry);
    }
  }

  return approvalState;
}

export function buildStoredApprovalEntries(approvalState: ApprovalState): string[] {
  return [
    ...Array.from(approvalState.allowedTools).sort().map((toolName) => `tool:${toolName}`),
    ...Array.from(approvalState.allowedCommandRules).sort(),
  ];
}

export function isPayloadApproved(payload: ToolExecutionPayload, approvalState: ApprovalState): boolean {
  if (!COMMAND_APPROVAL_TOOLS.has(payload.name)) {
    return approvalState.allowedTools.has(payload.name);
  }

  return getCommandApprovalRules(payload).some((rule) => approvalState.allowedCommandRules.has(rule));
}

export function persistApprovalRule(
  payload: ToolExecutionPayload,
  scope: Exclude<CommandApprovalScope, false>,
  approvalState: ApprovalState
): void {
  if (!COMMAND_APPROVAL_TOOLS.has(payload.name)) {
    approvalState.allowedTools.add(payload.name);
    return;
  }

  const commandRule = getCommandApprovalRule(payload, scope);
  if (commandRule) {
    approvalState.allowedCommandRules.add(commandRule);
  }
}

export function getApprovalLabel(
  payload: ToolExecutionPayload,
  scope: Exclude<CommandApprovalScope, false> = "exact"
): string {
  const command = getPayloadCommand(payload);
  if (COMMAND_APPROVAL_TOOLS.has(payload.name) && command) {
    const rule = getCommandApprovalRule(payload, scope);
    return rule ? `${payload.name} -> ${rule}` : `${payload.name} -> ${command}`;
  }
  return payload.name;
}

function getCommandApprovalRules(payload: ToolExecutionPayload): string[] {
  const exact = getCommandApprovalRule(payload, "exact");
  const executable = getCommandApprovalRule(payload, "executable");
  const prefix = getCommandApprovalRule(payload, "prefix");
  return [exact, executable, prefix].filter((value): value is string => Boolean(value));
}

function getCommandApprovalRule(
  payload: ToolExecutionPayload,
  scope: Exclude<CommandApprovalScope, false>
): string | null {
  const command = getPayloadCommand(payload);
  if (!command) {return null;}
  const context = getCommandApprovalContext(payload);

  if (scope === "exact") {
    return `command-exact:${payload.name}:${context}:${command}`;
  }

  if (!isCommandApprovalScopeAllowed(command, scope)) {
    return null;
  }

  const executable = getCommandExecutable(command);
  if (!executable) {return null;}

  if (scope === "executable") {
    return `command-executable:${payload.name}:${context}:${executable}`;
  }

  const prefix = getCommandPrefix(command);
  return prefix ? `command-prefix:${payload.name}:${context}:${prefix}` : null;
}

function getCommandApprovalContext(payload: ToolExecutionPayload): string {
  const args = isRecord(payload.arguments) ? payload.arguments : {};
  const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
  const profile = typeof args.profile === "string" && args.profile.trim()
    ? args.profile.trim()
    : "default";
  return `${encodeURIComponent(path)}:${encodeURIComponent(profile)}`;
}

function getPayloadCommand(payload: ToolExecutionPayload): string | null {
  const args: unknown = payload.arguments;
  if (!isRecord(args)) {return null;}
  return normalizeCommandValue(args.command);
}

function upgradeLegacyCommandRule(entry: string): string {
  if (!entry.startsWith("command:")) {
    return entry;
  }

  return entry.replace(/^command:/, "command-exact:");
}

function normalizeStoredApprovalEntry(entry: string): string | null {
  if (entry.startsWith("tool:")) {
    const toolEntry = entry.slice("tool:".length);
    return toolEntry ? upgradeLegacyCommandRule(toolEntry) : null;
  }

  return upgradeLegacyCommandRule(entry);
}

function isCommandRuleEntry(entry: string): boolean {
  return COMMAND_RULE_PREFIXES.some((prefix) => entry.startsWith(prefix));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
