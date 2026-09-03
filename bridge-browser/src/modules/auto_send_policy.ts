export type AutoSendAction = "ctrl-enter" | "enter" | "button";

const AUTO_SEND_ACTIONS: readonly AutoSendAction[] = [
  "enter",
  "ctrl-enter",
  "button",
  "enter",
  "ctrl-enter",
];
const AUTO_SEND_FILE_ATTEMPTS = 20;

export function getAutoSendAttemptLimit(hasFileUpload: boolean): number {
  return hasFileUpload ? AUTO_SEND_FILE_ATTEMPTS : AUTO_SEND_ACTIONS.length;
}

export function getAutoSendAction(attemptIndex: number): AutoSendAction {
  return AUTO_SEND_ACTIONS[attemptIndex % AUTO_SEND_ACTIONS.length] ?? "enter";
}
