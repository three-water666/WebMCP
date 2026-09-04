import {
  getBridgeRedemptionError,
  normalizeRedeemedBridgeSession,
} from "../src/background/bridge_redemption";
import { normalizeSession } from "../src/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function main(): void {
  const valid = normalizeRedeemedBridgeSession({
    success: true,
    idleTimeoutMs: 60 * 60 * 1000,
    siteId: "chatgpt",
    targetOrigin: "https://chatgpt.com",
    targetUrl: "https://chatgpt.com/",
    token: "session-token",
    vscodeExtensionVersion: "1.0.1",
    workspaceId: "workspace",
  });
  assert(valid?.token === "session-token", "valid bridge redemption was rejected");
  assert(valid.idleTimeoutMs === 60 * 60 * 1000, "gateway idle timeout was not retained");

  const mismatchedOrigin = normalizeRedeemedBridgeSession({
    ...valid,
    success: true,
    targetOrigin: "https://attacker.example",
  });
  assert(mismatchedOrigin === null, "mismatched target origin was accepted");

  const unsafeTarget = normalizeRedeemedBridgeSession({
    ...valid,
    success: true,
    targetOrigin: "null",
    targetUrl: "file:///tmp/secret",
  });
  assert(unsafeTarget === null, "non-HTTP bridge target was accepted");

  const stored = normalizeSession({
    port: 34567,
    token: valid.token,
    gatewayIdleTimeoutMs: valid.idleTimeoutMs,
  });
  assert(stored?.gatewayIdleTimeoutMs === valid.idleTimeoutMs, "session idle timeout was not persisted");

  assert(
    getBridgeRedemptionError({ error: "expired" }) === "expired",
    "gateway redemption error was not preserved"
  );
  console.log("PASS validates bridge redemption sessions and idle timeout metadata");
}

main();
