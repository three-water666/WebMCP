async page => {
  const target = await page.evaluate(async () => {
    if (!globalThis.chrome?.tabs || !globalThis.chrome.storage?.local) {
      throw new Error('The current page is not a WebCode browser-extension page.');
    }

    const stored = await globalThis.chrome.storage.local.get(null);
    const sessions = Object.entries(stored)
      .filter(([key, value]) => key.startsWith('session_') && value?.targetOrigin)
      .map(([key, value]) => ({
        session: value,
        tabId: Number(key.slice('session_'.length)),
      }));

    for (const candidate of sessions) {
      try {
        const tab = await globalThis.chrome.tabs.get(candidate.tabId);
        if (tab.url && new URL(tab.url).origin === candidate.session.targetOrigin) {
          await globalThis.chrome.tabs.update(candidate.tabId, { active: true });
          return {
            siteId: candidate.session.siteId,
            tabId: candidate.tabId,
            targetUrl: tab.url,
          };
        }
      } catch {
        // Ignore stale sessions and continue looking for a live target tab.
      }
    }

    throw new Error('No active WebCode bridge session was found.');
  });

  await page.reload();
  await page.locator('body').waitFor();
  return {
    ...target,
    popupText: await page.locator('body').innerText(),
  };
}
