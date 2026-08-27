// ABOUTME: Connects Slow Mode navigation policy to the browser webNavigation API.
// ABOUTME: Redirects eligible top-frame jumps and persists commute cooldown state.

import browser from "webextension-polyfill";
import {
  SLOW_MODE_SETTINGS_KEY,
  SLOW_MODE_STATE_KEY,
  createCommuteUrl,
  evaluateSlowModeNavigation,
  normalizeSlowModeSettings,
  normalizeSlowModeState,
  recordSlowModeRide,
} from "./slowMode";

interface CommittedNavigation {
  tabId: number;
  frameId: number;
  url: string;
  transitionType: string;
  transitionQualifiers?: string[];
}

interface SlowModeNavigationDependencies {
  getStorage: () => Promise<Record<string, unknown>>;
  setStorage: (items: Record<string, unknown>) => Promise<void>;
  getCommutePageUrl: () => string;
  updateTab: (tabId: number, url: string) => Promise<unknown>;
  now: () => number;
  random: () => number;
}

export function createSlowModeNavigationHandler(
  dependencies: SlowModeNavigationDependencies,
) {
  const tabUrls = new Map<number, string>();
  let navigationQueue = Promise.resolve();

  return {
    rememberTabUrl(tabId: number, url: string): void {
      tabUrls.set(tabId, url);
    },

    rememberTabUrlIfMissing(tabId: number, url: string): void {
      if (!tabUrls.has(tabId)) tabUrls.set(tabId, url);
    },

    forgetTab(tabId: number): void {
      tabUrls.delete(tabId);
    },

    async onCommitted(details: CommittedNavigation): Promise<void> {
      if (details.frameId !== 0) return;

      const previousUrl = tabUrls.get(details.tabId) ?? null;
      tabUrls.set(details.tabId, details.url);
      const navigation = {
        previousUrl,
        destinationUrl: details.url,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers ?? [],
      };

      const previousNavigation = navigationQueue;
      let releaseNavigation: (() => void) | undefined;
      navigationQueue = new Promise<void>((resolve) => {
        releaseNavigation = resolve;
      });
      await previousNavigation;

      try {
        const stored = await dependencies.getStorage();
        const settings = normalizeSlowModeSettings(
          stored[SLOW_MODE_SETTINGS_KEY],
        );
        let state = normalizeSlowModeState(stored[SLOW_MODE_STATE_KEY]);
        const now = dependencies.now();
        const decision = evaluateSlowModeNavigation(
          navigation,
          settings,
          state,
          now,
          dependencies.random,
        );
        if (!decision.shouldCommute) {
          return;
        }

        const stopCount = dependencies.random() < 0.5 ? 2 : 3;
        state = recordSlowModeRide(state, {
          destinationUrl: details.url,
          startedAt: now,
          stopCount,
          outcome: "riding",
        });
        const ride = state.rides[0];
        await dependencies.setStorage({ [SLOW_MODE_STATE_KEY]: state });
        const commuteUrl = createCommuteUrl(
          dependencies.getCommutePageUrl(),
          details.url,
          ride.id,
          stopCount,
        );
        tabUrls.set(details.tabId, commuteUrl);
        await dependencies.updateTab(details.tabId, commuteUrl);
      } finally {
        releaseNavigation?.();
      }
    },
  };
}

interface BrowserWithWebNavigation {
  webNavigation?: {
    onBeforeNavigate?: {
      addListener: (
        listener: (details: Pick<CommittedNavigation, "tabId" | "frameId" | "url">) => void,
      ) => void;
    };
    onCommitted: {
      addListener: (
        listener: (details: CommittedNavigation) => void,
      ) => void;
    };
  };
}

export function initSlowModeInterception(): void {
  const handler = createSlowModeNavigationHandler({
    getStorage: () =>
      browser.storage.local.get([
        SLOW_MODE_SETTINGS_KEY,
        SLOW_MODE_STATE_KEY,
      ]) as Promise<Record<string, unknown>>,
    setStorage: (items) => browser.storage.local.set(items),
    getCommutePageUrl: () => browser.runtime.getURL("commute.html"),
    updateTab: (tabId, url) => browser.tabs.update(tabId, { url }),
    now: Date.now,
    random: Math.random,
  });

  const tabsApi = browser.tabs as Partial<typeof browser.tabs>;
  tabsApi
    .query?.({})
    .then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined && tab.url) {
          handler.rememberTabUrlIfMissing(tab.id, tab.url);
        }
      }
    })
    .catch(() => {});

  const browserApi = browser as typeof browser & BrowserWithWebNavigation;
  browserApi.webNavigation?.onBeforeNavigate?.addListener((details) => {
    if (details.frameId !== 0) return;
    tabsApi
      .get?.(details.tabId)
      .then((tab) => {
        if (tab.url && tab.url !== details.url) {
          handler.rememberTabUrlIfMissing(details.tabId, tab.url);
        }
      })
      .catch(() => {});
  });
  browserApi.webNavigation?.onCommitted.addListener((details) => {
    handler.onCommitted(details).catch((error) => {
      console.warn("[Slow Mode] navigation interception failed:", error);
    });
  });
  tabsApi.onRemoved?.addListener((tabId) => handler.forgetTab(tabId));

}
