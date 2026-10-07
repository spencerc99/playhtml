// ABOUTME: Persists whether inventory-owned page objects should start hidden on a web site.
// ABOUTME: Keys preferences by origin so hiding one site does not affect any other site.

import browser from "webextension-polyfill";

const STORAGE_KEY_PREFIX = "inventory:page-objects-hidden:v1:";

export function siteOriginFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function siteVisibilityStorageKey(siteOrigin: string): string {
  return `${STORAGE_KEY_PREFIX}${siteOrigin}`;
}

export async function pageObjectsAreHiddenOnSite(
  siteOrigin: string,
): Promise<boolean> {
  const key = siteVisibilityStorageKey(siteOrigin);
  const stored = await browser.storage.local.get(key);
  return stored[key] === true;
}

export async function hidePageObjectsOnSite(siteOrigin: string): Promise<void> {
  await browser.storage.local.set({
    [siteVisibilityStorageKey(siteOrigin)]: true,
  });
}

export async function showPageObjectsOnSite(siteOrigin: string): Promise<void> {
  await browser.storage.local.remove(siteVisibilityStorageKey(siteOrigin));
}
