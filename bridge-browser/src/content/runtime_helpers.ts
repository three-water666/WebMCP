import { isStatusResponse, type StatusResponse } from "../types";

export function getCurrentStatus(): Promise<StatusResponse | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response: unknown) => {
      resolve(isStatusResponse(response) ? response : null);
    });
  });
}

export function getStorage(
  area: chrome.storage.StorageArea,
  keys: string[]
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    area.get(keys, (items: Record<string, unknown>) => resolve(items));
  });
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
