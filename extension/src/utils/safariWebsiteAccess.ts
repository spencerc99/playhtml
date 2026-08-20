// ABOUTME: Checks and requests Safari access to ordinary website pages.
// ABOUTME: Uses the same HTTP and HTTPS origins declared by the extension manifest.

import browser from "webextension-polyfill";

export const SAFARI_WEBSITE_ORIGINS = ["http://*/*", "https://*/*"];

export function hasSafariWebsiteAccess(): Promise<boolean> {
  return browser.permissions.contains({
    origins: SAFARI_WEBSITE_ORIGINS,
  });
}

export function requestSafariWebsiteAccess(): Promise<boolean> {
  return browser.permissions.request({
    origins: SAFARI_WEBSITE_ORIGINS,
  });
}
