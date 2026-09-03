import {
  getAutoSendAction,
  getAutoSendAttemptLimit,
} from "../src/modules/auto_send_policy";

function main(): void {
  runTest("keeps five attempts for text-only sends", () => {
    assertEqual(getAutoSendAttemptLimit(false), 5, "text-only attempt limit changed");
  });
  runTest("allows twenty attempts after a file paste", () => {
    assertEqual(getAutoSendAttemptLimit(true), 20, "file upload attempt limit was not extended");
  });
  runTest("repeats the fallback action sequence during extended retries", () => {
    assertEqual(getAutoSendAction(2), "button", "initial button fallback changed");
    assertEqual(getAutoSendAction(7), "button", "extended retries did not repeat the button fallback");
  });
}

function runTest(name: string, test: () => void): void {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

main();
