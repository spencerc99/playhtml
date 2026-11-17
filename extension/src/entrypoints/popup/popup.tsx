// ABOUTME: Entry point for the extension popup UI.
// ABOUTME: Loads identity, collection status, portrait navigation, and settings views.

import React, { useState, useEffect, lazy, Suspense } from "react";
// Agentation is a dev-only toolbar — loaded at runtime so it never appears in the production bundle
const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : null;
import { createRoot } from "react-dom/client";
import "../../styles/popup.scss";
import "../../styles/touchTargets.scss";
import browser from "webextension-polyfill";
import { InternetPortraitHome } from "../../components/InternetPortraitHome";
import { refreshFeatureAccess } from "../../features/featureAccess";
import { useFeatureState } from "../../features/useFeatureAccess";
import {
  pageObjectsAreHiddenOnSite,
  showPageObjectsOnSite,
  siteOriginFromUrl,
} from "../../features/inventory/siteVisibility";
import { PlayerIdentity } from "../../types";
import { findOpenCommuteTab, openOrFocusCommute } from "./commuteNavigation";

const PUBLIC_CHANGELOG_URL = "https://wewere.online/changelog/";

function PlayHTMLPopup() {
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity | null>(
    null,
  );
  const [discoveredSites, setDiscoveredSites] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState<browser.Tabs.Tab | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const commuteEnabled = useFeatureState("COMMUTE").enabled;
  const [commuteIsOpen, setCommuteIsOpen] = useState(false);
  const [hiddenSite, setHiddenSite] = useState<{
    origin: string;
    name: string;
  } | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    loadPlayerData();
    // Load onboarding state
    (async () => {
      const readOnboarding = async () => {
        const result = await browser.storage.local.get("onboarding_complete");
        return (
          result.onboarding_complete === "true" ||
          result.onboarding_complete === true
        );
      };
      try {
        if (await readOnboarding()) {
          setOnboardingComplete(true);
          return;
        }
        // On iPhone, the other copy of the extension (Safari's, or the app's)
        // may already be set up; syncing first takes its setup instead of
        // asking for it again.
        await browser.runtime.sendMessage({ type: "SYNC_DEVICES" });
        setOnboardingComplete(await readOnboarding());
      } catch {
        setOnboardingComplete(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!commuteEnabled) return;
    findOpenCommuteTab()
      .then((tab) => setCommuteIsOpen(tab !== null))
      .catch(() => setCommuteIsOpen(false));
  }, [commuteEnabled]);

  useEffect(() => {
    if (import.meta.env.MODE === "development" || !playerIdentity?.publicKey)
      return;
    refreshFeatureAccess(playerIdentity.publicKey).catch(() => {});
  }, [playerIdentity?.publicKey]);

  const loadPlayerData = async () => {
    try {
      // Get current tab
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      setCurrentTab(tab);
      const siteOrigin = tab?.url ? siteOriginFromUrl(tab.url) : null;
      if (siteOrigin && (await pageObjectsAreHiddenOnSite(siteOrigin))) {
        setHiddenSite({
          origin: siteOrigin,
          name: new URL(siteOrigin).hostname,
        });
      } else {
        setHiddenSite(null);
      }

      // Get public identity and profile data
      const profile = await browser.runtime.sendMessage({
        type: "GET_PLAYER_PROFILE",
      });
      setPlayerIdentity(profile?.identity ?? null);
      setDiscoveredSites(
        Array.isArray(profile?.discoveredSites) ? profile.discoveredSites : [],
      );

      setIsLoading(false);
    } catch (error) {
      console.error("Failed to load player data:", error);
      setIsLoading(false);
    }
  };

  const toggleHistoricalOverlay = async () => {
    if (!currentTab?.id) return;

    try {
      await browser.tabs.sendMessage(currentTab.id, {
        type: "TOGGLE_HISTORICAL_OVERLAY",
      });
      window.close(); // Close popup
    } catch (error) {
      console.error("Failed to toggle historical overlay:", error);
    }
  };

  const showSatchelOnSite = async () => {
    if (!hiddenSite || !currentTab?.id) return;

    await showPageObjectsOnSite(hiddenSite.origin);
    setHiddenSite(null);
    try {
      await browser.tabs.sendMessage(currentTab.id, {
        type: "wwo:open-inventory",
      });
    } catch (error) {
      console.error("Failed to open the satchel on this page:", error);
    }
    window.close();
  };

  if (isLoading || onboardingComplete === null) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!onboardingComplete) {
    return (
      <div className="popup-onboarding">
        <header className="popup-onboarding__header">
          <h1 className="popup-onboarding__title">we were online</h1>
          <p className="popup-onboarding__subtitle">
            Finish setup to get started
          </p>
        </header>
        <main className="popup-onboarding__main">
          <p className="popup-onboarding__body">
            We’ll guide you through a quick setup in a full tab.
          </p>
          <button
            onClick={async () => {
              const url = browser.runtime.getURL("setup.html");
              await browser.tabs.create({ url });
              window.close();
            }}
            className="popup-onboarding__button"
          >
            Open Setup
          </button>
        </main>
      </div>
    );
  }

  return (
    <InternetPortraitHome
      playerIdentity={playerIdentity}
      discoveredSites={discoveredSites}
      onOpenSettings={() => void browser.runtime.openOptionsPage()}
      onViewHistory={toggleHistoricalOverlay}
      onViewCommute={async () => {
        await openOrFocusCommute();
        window.close();
      }}
      commuteIsOpen={commuteIsOpen}
      onViewBrowsingHistory={async () => {
        const url = browser.runtime.getURL("walking-record.html");
        await browser.tabs.create({ url });
        window.close();
      }}
      onViewScraps={async () => {
        const url = browser.runtime.getURL("scraps.html");
        await browser.tabs.create({ url });
        window.close();
      }}
      onViewChangelog={async () => {
        await browser.tabs.create({ url: PUBLIC_CHANGELOG_URL });
        window.close();
      }}
      hiddenSiteName={hiddenSite?.name}
      onShowSatchel={hiddenSite ? showSatchelOnSite : undefined}
    />
  );
}

// Mount the popup
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <>
      {Agentation && (
        <Suspense fallback={null}>
          <Agentation />
        </Suspense>
      )}
      <PlayHTMLPopup />
    </>,
  );
}

export default PlayHTMLPopup;
