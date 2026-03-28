// ABOUTME: Dispatches custom site logic based on the current domain.
// ABOUTME: Each site module initializes domain-specific collaborative features.

import type { PageDataChannel, PresenceAPI, PresenceRoom } from "@playhtml/common";

export interface CustomSiteDeps {
  createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>;
  createPresenceRoom: (name: string) => PresenceRoom;
  presence: PresenceAPI;
  cursorClient: any;
  playerColor: string;
}

// Returns true if the current domain should have collaborative cursors enabled.
export function shouldEnableCursors(): boolean {
  return location.hostname.endsWith("wikipedia.org");
}

export async function initCustomSite(deps: CustomSiteDeps): Promise<(() => void) | null> {
  const hostname = location.hostname;

  if (hostname.endsWith("wikipedia.org")) {
    const { initWikipedia } = await import("./wikipedia");
    return initWikipedia(deps);
  }

  return null;
}
