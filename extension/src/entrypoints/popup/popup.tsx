import React, { useState, useEffect, lazy, Suspense } from "react";
// Agentation is a dev-only toolbar — loaded at runtime so it never appears in the production bundle
const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : null;
import { createRoot } from "react-dom/client";
import "../../styles/popup.scss";
import browser from "webextension-polyfill";
import { Inventory } from "../../components/Inventory";
import { PlayerIdentityCard } from "../../components/PlayerIdentityCard";
import { SiteStatus } from "../../components/SiteStatus";
import { QuickActions } from "../../components/QuickActions";
import { Collections } from "../../components/Collections";
import { InternetPortraitHome } from "../../components/InternetPortraitHome";
import { ProfilePage } from "../../components/ProfilePage";
import { FLAGS } from "../../flags";
import {
  PlayerIdentity,
  GameInventory,
  InventoryItem,
  PlayHTMLStatus,
} from "../../types";

function PlayHTMLPopup() {
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity | null>(
    null,
  );
  const [currentTab, setCurrentTab] = useState<browser.Tabs.Tab | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playhtmlStatus, setPlayhtmlStatus] = useState<PlayHTMLStatus>({
    detected: false,
    elementCount: 0,
    checking: true,
  });
  const [inventory, setInventory] = useState<GameInventory>({
    items: [],
    totalItems: 0,
    lastUpdated: 0,
  });
  const [currentView, setCurrentView] = useState<
    "main" | "inventory" | "collections" | "profile"
  >("main");
  const [devFeaturesEnabled, setDevFeaturesEnabled] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    loadPlayerData();
    // Load dev override and onboarding flags
    (async () => {
      try {
        const result = await browser.storage.local.get([
          "devFeaturesEnabled",
          "onboarding_complete",
        ]);
        setDevFeaturesEnabled(Boolean(result.devFeaturesEnabled));
        setOnboardingComplete(
          result.onboarding_complete === "true" ||
            result.onboarding_complete === true,
        );
      } catch {
        setDevFeaturesEnabled(false);
        setOnboardingComplete(false);
      }
    })();

    // Dev hotkey: Cmd/Ctrl+Shift+.
    const onKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ".") {
        e.preventDefault();
        setDevFeaturesEnabled((prev) => {
          const next = !prev;
          // Fire and forget; state is source of truth for UI
          browser.storage.local
            .set({ devFeaturesEnabled: next })
            .catch(() => {});
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadPlayerData = async () => {
    try {
      // Get current tab
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      setCurrentTab(tab);

      // Get player identity
      const identity = await browser.runtime.sendMessage({
        type: "GET_PLAYER_IDENTITY",
      });
      setPlayerIdentity(identity);

      // Check PlayHTML status on current page
      await checkPlayHtmlStatus(tab);

      // Load inventory
      await loadInventory();

      setIsLoading(false);
    } catch (error) {
      console.error("Failed to load player data:", error);
      setIsLoading(false);
    }
  };

  const checkPlayHtmlStatus = async (tab: browser.Tabs.Tab | null) => {
    if (!tab?.id) return;

    try {
      const response = await browser.tabs.sendMessage(tab.id, {
        type: "CHECK_PLAYHTML_STATUS",
      });

      if (response) {
        setPlayhtmlStatus({
          detected: response.elementCount > 0,
          elementCount: response.elementCount,
          checking: false,
        });
      }
    } catch (error) {
      console.error("Failed to check PlayHTML status:", error);
      setPlayhtmlStatus({
        detected: false,
        elementCount: 0,
        checking: false,
      });
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

  const addInventoryItem = async (
    item: Omit<InventoryItem, "id" | "collectedAt">,
  ) => {
    const newItem: InventoryItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      collectedAt: Date.now(),
    };

    const updatedInventory: GameInventory = {
      items: [...inventory.items, newItem],
      totalItems: inventory.totalItems + 1,
      lastUpdated: Date.now(),
    };

    setInventory(updatedInventory);
    await browser.storage.local.set({ gameInventory: updatedInventory });
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

  const activateElementPicker = async () => {
    if (!currentTab?.id) return;

    try {
      // Close popup (Chrome behavior) and activate element picker
      await browser.tabs.sendMessage(currentTab.id, {
        type: "ACTIVATE_ELEMENT_PICKER",
      });
      window.close(); // Close popup
    } catch (error) {
      console.error("Failed to activate element picker:", error);
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

  const bagEnabled = devFeaturesEnabled || FLAGS.COPRESENCE;

  const pingContentScript = async () => {
    try {
      if (currentTab?.id) {
        const response = await browser.tabs.sendMessage(currentTab.id, {
          type: "PING",
        });
      }
    } catch (error) {
      console.error("Failed to ping content script:", error);
    }
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
              const url = browser.runtime.getURL("options.html");
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

  if (currentView === "profile" && playerIdentity) {
    return (
      <ProfilePage
        playerIdentity={playerIdentity}
        onBack={() => setCurrentView("main")}
        onIdentityUpdated={(updated) => setPlayerIdentity(updated)}
      />
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

  if (currentView === "collections") {
    return <Collections onBack={() => setCurrentView("main")} />;
  }

  if (!bagEnabled) {
    return (
      <InternetPortraitHome
        playerIdentity={playerIdentity}
        onViewCollections={() => setCurrentView("collections")}
        onViewHistory={toggleHistoricalOverlay}
        onViewProfile={() => setCurrentView("profile")}
      />
    );
  }

  return (
    <div
      style={{
        padding: "16px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ marginBottom: "16px" }}>
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "18px",
            color: "#1f2937",
            fontFamily: "'Lora', Georgia, serif",
          }}
        >
          we were online{" "}
        </h1>
        <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>
          Transform any webpage into an interactive playground
        </p>
      </header>

      <main style={{ flex: 1, overflow: "auto" }}>
        {playerIdentity && (
          <PlayerIdentityCard playerIdentity={playerIdentity} />
        )}
        {bagEnabled && (
          <SiteStatus currentTab={currentTab} playhtmlStatus={playhtmlStatus} />
        )}

        <QuickActions
          onTestConnection={pingContentScript}
          onPickElement={activateElementPicker}
          onViewInventory={() => setCurrentView("inventory")}
          onViewCollections={() => setCurrentView("collections")}
          onViewHistory={toggleHistoricalOverlay}
          inventory={inventory}
          showBagFeatures={bagEnabled}
        />
      </main>

      <footer
        style={{
          marginTop: "16px",
          paddingTop: "16px",
          borderTop: "1px solid #e5e7eb",
          fontSize: "10px",
          color: "#9ca3af",
          textAlign: "center",
        }}
      >
        we were online v{browser.runtime.getManifest().version}
      </footer>
    </div>
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
