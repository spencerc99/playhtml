// ABOUTME: Opens the public Internet Commute from the extension popup.
// ABOUTME: Reuses an existing carriage tab instead of opening duplicate trains.

import browser from "webextension-polyfill";

export const PUBLIC_COMMUTE_URL = "https://wewere.online/commute/";
const PUBLIC_COMMUTE_TAB_PATTERN = "https://wewere.online/commute*";

export async function findOpenCommuteTab(): Promise<browser.Tabs.Tab | null> {
  const [tab] = await browser.tabs.query({
    url: PUBLIC_COMMUTE_TAB_PATTERN,
  });
  return tab ?? null;
}

export async function openOrFocusCommute(): Promise<void> {
  const tab = await findOpenCommuteTab();
  if (tab?.id !== undefined) {
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) {
      await browser.windows.update(tab.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: PUBLIC_COMMUTE_URL });
}
