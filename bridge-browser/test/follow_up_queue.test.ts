import { FollowUpQueue } from "../src/content/follow_up_queue";

function main(): void {
  runTest("only confirmed follow-ups enter delivery", testConfirmedDeliveryOnly);
  runTest("successful delivery removes only the sent snapshot", testSuccessfulDelivery);
  runTest("failed delivery returns messages to the confirmed queue", testFailedDelivery);
}

function testConfirmedDeliveryOnly(): void {
  const queue = new FollowUpQueue();
  assertEqual(queue.confirm("   "), null, "blank draft was confirmed");
  queue.confirm("  first detail  ");
  queue.confirm("second\ndetail");

  const delivery = queue.beginDelivery();
  assertEqual(delivery.messages.join("|"), "first detail|second\ndetail", "confirmed text changed");
}

function testSuccessfulDelivery(): void {
  const queue = new FollowUpQueue();
  queue.confirm("first detail");
  const firstDelivery = queue.beginDelivery();
  queue.confirm("arrived during delivery");
  queue.completeDelivery(firstDelivery.ids);

  const nextDelivery = queue.beginDelivery();
  assertEqual(nextDelivery.messages.length, 1, "sent follow-up remained visible");
  assertEqual(nextDelivery.messages[0], "arrived during delivery", "later follow-up was removed early");
}

function testFailedDelivery(): void {
  const queue = new FollowUpQueue();
  queue.confirm("retry me");
  const delivery = queue.beginDelivery();
  assert(!queue.remove(delivery.ids[0] ?? ""), "sending follow-up was removable");
  queue.releaseDelivery(delivery.ids);

  const retry = queue.beginDelivery();
  assertEqual(retry.messages[0], "retry me", "failed follow-up was lost");
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

main();
