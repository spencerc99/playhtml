// ABOUTME: Entry point for the extension popup UI.
// ABOUTME: Loads identity, collection status, portrait navigation, and settings views.

import React, { useState, useEffect, lazy, Suspense } from "react";
// Agentation is a dev-only toolbar — loaded at runtime so it never appears in the production bundle
const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : null;
import { createRoot } from "react-dom/client";
import "../../styles/popup.scss";
import browser from "webextension-polyfill";
import { Inventory } from "../../components/Inventory";
import { InternetPortraitHome } from "../../components/InternetPortraitHome";
import { refreshFeatureAccess } from "../../features/featureAccess";
import { useFeatureState } from "../../features/useFeatureAccess";
import {
  pageObjectsAreHiddenOnSite,
  showPageObjectsOnSite,
  siteOriginFromUrl,
} from "../../features/inventory/siteVisibility";
import { PlayerIdentity, GameInventory, InventoryItem } from "../../types";
import { findOpenCommuteTab, openOrFocusCommute } from "./commuteNavigation";

const PUBLIC_CHANGELOG_URL = "https://wewere.online/changelog/";

function PlayHTMLPopup() {
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity | null>(
    null,
  );
  const [discoveredSites, setDiscoveredSites] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState<browser.Tabs.Tab | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inventory, setInventory] = useState<GameInventory>({
    items: [],
    totalItems: 0,
    lastUpdated: 0,
  });
  const [currentView, setCurrentView] = useState<"main" | "inventory">("main");
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
      try {
        const result = await browser.storage.local.get("onboarding_complete");
        setOnboardingComplete(
          result.onboarding_complete === "true" ||
            result.onboarding_complete === true,
        );
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

      // Load inventory
      await loadInventory();

      setIsLoading(false);
    } catch (error) {
      console.error("Failed to load player data:", error);
      setIsLoading(false);
    }
  };

  const loadInventory = async () => {
    try {
      const result = await browser.storage.local.get(["gameInventory"]);
      const storedInventory = result.gameInventory;

      if (storedInventory) {
        setInventory(storedInventory);
      } else {
        // Initialize empty inventory
        const emptyInventory: GameInventory = {
          items: [],
          totalItems: 0,
          lastUpdated: Date.now(),
        };
        await browser.storage.local.set({ gameInventory: emptyInventory });
        setInventory(emptyInventory);
      }
    } catch (error) {
      console.error("Failed to load inventory:", error);
    }
  };

  const removeFromInventory = async (itemId: string) => {
    try {
      const updatedInventory: GameInventory = {
        ...inventory,
        items: inventory.items.filter(
          (item: InventoryItem) => item.id !== itemId,
        ),
        totalItems: Math.max(0, inventory.totalItems - 1),
        lastUpdated: Date.now(),
      };

      setInventory(updatedInventory);
      await browser.storage.local.set({ gameInventory: updatedInventory });
    } catch (error) {
      console.error("Failed to remove item from inventory:", error);
    }
  };

  const clearInventory = async () => {
    if (
      confirm(
        "Are you sure you want to clear your entire inventory? This cannot be undone.",
      )
    ) {
      try {
        const emptyInventory: GameInventory = {
          items: [],
          totalItems: 0,
          lastUpdated: Date.now(),
        };

        setInventory(emptyInventory);
        await browser.storage.local.set({ gameInventory: emptyInventory });
      } catch (error) {
        console.error("Failed to clear inventory:", error);
      }
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
      <div
        style={{
          padding: 16,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ marginBottom: 12 }}>
          <h1
            style={{
              margin: "0 0 6px 0",
              fontSize: 18,
              color: "#111827",
              fontStyle: "italic",
              fontFamily: "'Lora', Georgia, serif",
            }}
          >
            we were online
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
            Finish setup to get started
          </p>
        </header>
        <main style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "#4b5563" }}>
            We’ll guide you through a quick setup in a full tab.
          </p>
          <button
            onClick={async () => {
              const url = browser.runtime.getURL("setup.html");
              await browser.tabs.create({ url });
              window.close();
            }}
            style={{
              padding: "10px 12px",
              background: "var(--accent-teal, #4a9a8a)",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Open Setup
          </button>
        </main>
      </div>
    );
  }

  if (currentView === "inventory") {
    return (
      <Inventory
        inventory={inventory}
        onBack={() => setCurrentView("main")}
        onRemoveItem={removeFromInventory}
        onClearInventory={clearInventory}
      />
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
