import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";

interface PlayerIdentity {
  publicKey: string;
  playerStyle: {
    colorPalette: string[];
    animationStyle: string;
  };
  discoveredSites: string[];
  createdAt: number;
}

function PlayHTMLPopup() {
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity | null>(
    null
  );
  const [currentTab, setCurrentTab] = useState<browser.Tabs.Tab | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playhtmlStatus, setPlayhtmlStatus] = useState<{
    detected: boolean;
    elementCount: number;
    checking: boolean;
  }>({ detected: false, elementCount: 0, checking: true });

  useEffect(() => {
    loadPlayerData();
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

  const pingContentScript = async () => {
    try {
      if (currentTab?.id) {
        const response = await browser.tabs.sendMessage(currentTab.id, {
          type: "PING",
        });
        console.log("Content script response:", response);
      }
    } catch (error) {
      console.error("Failed to ping content script:", error);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <div>Loading PlayHTML Bag...</div>
      </div>
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
        <h1 style={{ margin: "0 0 8px 0", fontSize: "18px", color: "#1f2937" }}>
          PlayHTML Bag
        </h1>
        <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>
          Transform any webpage into an interactive playground
        </p>
      </header>

      <main style={{ flex: 1, overflow: "auto" }}>
        {playerIdentity && (
          <section style={{ marginBottom: "16px" }}>
            <h3
              style={{
                margin: "0 0 8px 0",
                fontSize: "14px",
                color: "#374151",
              }}
            >
              Your Identity
            </h3>
            <div
              style={{
                background: "#f9fafb",
                padding: "8px",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            >
              <div style={{ marginBottom: "4px" }}>
                <strong>ID:</strong> {playerIdentity.publicKey.slice(0, 12)}...
              </div>
              <div style={{ marginBottom: "4px" }}>
                <strong>Sites discovered:</strong>{" "}
                {playerIdentity.discoveredSites.length}
              </div>
              <div
                style={{ display: "flex", gap: "4px", alignItems: "center" }}
              >
                <strong>Colors:</strong>
                {playerIdentity.playerStyle.colorPalette.map((color, i) => (
                  <div
                    key={i}
                    style={{
                      width: "12px",
                      height: "12px",
                      backgroundColor: color,
                      borderRadius: "2px",
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <section style={{ marginBottom: "16px" }}>
          <h3
            style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#374151" }}
          >
            Current Site
          </h3>
          <div
            style={{
              background: "#f9fafb",
              padding: "8px",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          >
            <div style={{ marginBottom: "4px" }}>
              <strong>URL:</strong>{" "}
              {currentTab?.url ? new URL(currentTab.url).hostname : "Unknown"}
            </div>
            <div>
              <strong>PlayHTML detected:</strong>{" "}
              {playhtmlStatus.checking 
                ? "Checking..." 
                : playhtmlStatus.detected 
                  ? `Yes (${playhtmlStatus.elementCount} elements)`
                  : "No"}
            </div>
          </div>
        </section>

        <section>
          <h3
            style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#374151" }}
          >
            Quick Actions
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={pingContentScript}
              style={{
                padding: "8px 12px",
                background: "#6366f1",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Test Connection
            </button>
            <button
              style={{
                padding: "8px 12px",
                background: "#e5e7eb",
                color: "#374151",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
              }}
              onClick={() => activateElementPicker()}
            >
              Pick Element
            </button>
            <button
              style={{
                padding: "8px 12px",
                background: "#e5e7eb",
                color: "#374151",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
              }}
              disabled
            >
              View Inventory (Coming Soon)
            </button>
          </div>
        </section>
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
        PlayHTML Extension v0.1.0
      </footer>
    </div>
  );
}

// Mount the popup
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<PlayHTMLPopup />);
}

export default PlayHTMLPopup;
