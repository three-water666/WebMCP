import type { ToolExecutionPayload } from "../src/types";
import {
  createApprovalState,
  isPayloadApproved,
  parseStoredApprovalEntries,
  persistApprovalRule,
} from "../src/content/approval_policy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function executeCommand(argumentsValue: Record<string, unknown>): ToolExecutionPayload {
  return {
    name: "execute_command",
    arguments: {
      command: "git status",
      ...argumentsValue,
    },
  };
}

function runInTerminal(argumentsValue: Record<string, unknown>): ToolExecutionPayload {
  return {
    name: "run_in_terminal",
    arguments: {
      command: "git status",
      ...argumentsValue,
    },
  };
}

function main(): void {
  const executeState = createApprovalState();
  const legacyPosixPayload = executeCommand({});
  const explicitDefaultPayload = executeCommand({ profile: "default" });

  persistApprovalRule(legacyPosixPayload, "exact", executeState);
  assert(isPayloadApproved(legacyPosixPayload, executeState), "omitted execute profile approval was not retained");
  assert(
    !isPayloadApproved(explicitDefaultPayload, executeState),
    "omitted execute profile approval leaked into the explicit default profile"
  );

  const ambiguousLegacyState = parseStoredApprovalEntries([
    "command-exact:execute_command:.:default:git status",
  ]);
  assert(
    !isPayloadApproved(legacyPosixPayload, ambiguousLegacyState)
      && !isPayloadApproved(explicitDefaultPayload, ambiguousLegacyState),
    "legacy ambiguous default-profile approvals should not match either execute mode"
  );

  const terminalState = createApprovalState();
  persistApprovalRule(runInTerminal({}), "exact", terminalState);
  assert(
    isPayloadApproved(runInTerminal({ profile: "default" }), terminalState),
    "run_in_terminal omitted and explicit default profiles should share the same context"
  );

  process.stdout.write("✓ command approvals distinguish legacy execute profile semantics\n");
}

main();
