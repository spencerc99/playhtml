// ABOUTME: Loads the extension's React page UI only when a content-script event needs it.
// ABOUTME: Reuses the registered UI API after the first on-demand module load.

import browser from "webextension-polyfill";
import type { ContentPageUI } from "./content-page-ui";

export async function loadContentPageUI(): Promise<ContentPageUI> {
  if (!globalThis.wwoContentPageUI) {
    const contentPageUIUrl = browser.runtime.getURL("content-page-ui.js");
    await import(/* @vite-ignore */ contentPageUIUrl);
  }

  if (!globalThis.wwoContentPageUI) {
    throw new Error("Content page UI did not register after loading");
  }

  return globalThis.wwoContentPageUI;
}
