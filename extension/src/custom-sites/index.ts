// ABOUTME: Dispatches custom site logic based on the current domain.
// ABOUTME: Each site module initializes domain-specific collaborative features.

import type { PageDataChannel, PresenceAPI } from "@playhtml/common";

export interface CustomSiteDeps {
  createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>;
  presence: PresenceAPI;
  cursorClient: any;
  playerColor: string;
}

export async function initCustomSite(deps: CustomSiteDeps): Promise<(() => void) | null> {
  const hostname = location.hostname;

  if (hostname.endsWith("wikipedia.org")) {
    const { initWikipedia } = await import("./wikipedia");
    return initWikipedia(deps);
  }

  return null;
}
