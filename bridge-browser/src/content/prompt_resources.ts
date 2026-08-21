import { getPlatformPromptStorageKey as buildPlatformPromptStorageKey } from "@webcode/shared";
import { i18n } from "../modules/i18n";

const lang = i18n.lang;

export const promptStorageKeys = {
  prompt: lang === "zh" ? "prompt_zh" : "prompt_en",
  train: lang === "zh" ? "train_zh" : "train_en",
  error: lang === "zh" ? "error_hint_zh" : "error_hint_en",
  init: lang === "zh" ? "init_zh" : "init_en",
  oversize: lang === "zh" ? "oversize_zh" : "oversize_en",
  protocolJson: lang === "zh" ? "protocol_json_zh" : "protocol_json_en",
  protocolXml: lang === "zh" ? "protocol_xml_zh" : "protocol_xml_en",
} as const;

const promptStorageKeyList = Object.values(promptStorageKeys);

export function loadPromptsFromStorage(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(promptStorageKeyList, (items: Record<string, unknown>) => {
      const prompt = readStorageString(items, promptStorageKeys.prompt);
      const train = readStorageString(items, promptStorageKeys.train);
      const error = readStorageString(items, promptStorageKeys.error);
      const init = readStorageString(items, promptStorageKeys.init);
      const oversize = readStorageString(items, promptStorageKeys.oversize);
      const protocolJson = readStorageString(items, promptStorageKeys.protocolJson);
      const protocolXml = readStorageString(items, promptStorageKeys.protocolXml);

      if (prompt) { i18n.resources.prompt = prompt; }
      if (train) { i18n.resources.train = train; }
      if (error) { i18n.resources.error = error; }
      if (init) { i18n.resources.init = init; }
      if (oversize) { i18n.resources.oversize = oversize; }
      if (protocolJson) { i18n.resources.protocolJson = protocolJson; }
      if (protocolXml) { i18n.resources.protocolXml = protocolXml; }
      resolve();
    });
  });
}

export function hasPromptResourceChange(
  changes: Record<string, chrome.storage.StorageChange>,
  siteId?: string | null
): boolean {
  const platformPromptKey = getPlatformPromptStorageKey(siteId);
  return promptStorageKeyList.some((key) => Boolean(changes[key])) ||
    Boolean(platformPromptKey && changes[platformPromptKey]);
}

export function getPlatformPromptStorageKey(siteId?: string | null): string | null {
  return buildPlatformPromptStorageKey(siteId, lang);
}

export function readPlatformPromptFromStorage(siteId?: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const platformPromptKey = getPlatformPromptStorageKey(siteId);
    if (!platformPromptKey) {
      resolve(null);
      return;
    }

    chrome.storage.local.get([platformPromptKey], (items: Record<string, unknown>) => {
      resolve(readStorageString(items, platformPromptKey) ?? null);
    });
  });
}

function readStorageString(items: Record<string, unknown>, key: string): string | undefined {
  const value = items[key];
  return typeof value === "string" && value ? value : undefined;
}
