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

interface InventoryItem {
  id: string;
  type: 'element' | 'site_signature' | 'interaction';
  name: string;
  description: string;
  collectedAt: number;
  sourceUrl: string;
  data?: any;
}

interface GameInventory {
  items: InventoryItem[];
  totalItems: number;
  lastUpdated: number;
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
  const [inventory, setInventory] = useState<GameInventory>({
    items: [],
    totalItems: 0,
    lastUpdated: 0,
  });
  const [currentView, setCurrentView] = useState<'main' | 'inventory'>('main');

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
      const result = await browser.storage.local.get(['gameInventory']);
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

  const addInventoryItem = async (item: Omit<InventoryItem, 'id' | 'collectedAt'>) => {
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

  const renderInventoryView = () => {
    return (
      <div
        style={{
          padding: "16px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setCurrentView('main')}
            style={{
              background: "none",
              border: "none",
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            ←
          </button>
          <h1 style={{ margin: 0, fontSize: "18px", color: "#1f2937" }}>
            Inventory ({inventory.totalItems})
          </h1>
        </header>

        <main style={{ flex: 1, overflow: "auto" }}>
          {inventory.items.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#6b7280",
                fontSize: "14px",
              }}
            >
              <div style={{ marginBottom: "8px" }}>Your bag is empty</div>
              <div>Start exploring to collect items!</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {inventory.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "8px",
                    fontSize: "11px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    minHeight: "140px",
                  }}
                >
                  <div style={{ marginBottom: "8px", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "60px" }}>
                    {item.type === 'site_signature' ? (
                      <img 
                        src={item.data?.favicon || `${new URL(item.sourceUrl).origin}/favicon.ico`}
                        alt="Site favicon"
                        style={{ 
                          width: "32px", 
                          height: "32px", 
                          borderRadius: "4px",
                          objectFit: "cover",
                        }}
                        onError={(e) => {
                          // Fallback to generic site icon SVG
                          (e.target as HTMLImageElement).src = `data:image/svg+xml;base64,${btoa(`
                            <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
                              <rect width="32" height="32" fill="#10b981" rx="4"/>
                              <text x="16" y="20" font-family="Arial" font-size="12" fill="white" text-anchor="middle">🌐</text>
                            </svg>
                          `)}`
                        }}
                      />
                    ) : (
                      <img 
                        src={item.data?.snapshot}
                        alt="Element snapshot"
                        style={{ 
                          maxWidth: "100px", 
                          maxHeight: "60px", 
                          borderRadius: "4px",
                          objectFit: "contain",
                          border: "1px solid #e5e7eb"
                        }}
                        onError={(e) => {
                          // Fallback to generic element icon
                          (e.target as HTMLImageElement).src = `data:image/svg+xml;base64,${btoa(`
                            <svg width="100" height="60" xmlns="http://www.w3.org/2000/svg">
                              <rect width="100" height="60" fill="#6366f1" rx="4"/>
                              <text x="50" y="35" font-family="Arial" font-size="10" fill="white" text-anchor="middle">📦</text>
                            </svg>
                          `)}`
                        }}
                      />
                    )}
                  </div>
                  
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "12px", color: "#1f2937", marginBottom: "2px", lineHeight: "1.2" }}>
                        {item.name.length > 25 ? item.name.slice(0, 25) + '...' : item.name}
                      </div>
                      <div style={{ color: "#6b7280", fontSize: "10px", marginBottom: "6px", lineHeight: "1.2" }}>
                        {item.description.length > 40 ? item.description.slice(0, 40) + '...' : item.description}
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "4px" }}>
                      <span
                        style={{
                          background: getItemTypeColor(item.type),
                          color: "white",
                          padding: "1px 4px",
                          borderRadius: "3px",
                          fontSize: "9px",
                          fontWeight: "500",
                        }}
                      >
                        {item.type === 'site_signature' ? 'site' : 'item'}
                      </span>
                      <span style={{ color: "#9ca3af", fontSize: "9px" }}>
                        {new Date(item.collectedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
          {inventory.items.length > 0 && `Last updated ${new Date(inventory.lastUpdated).toLocaleDateString()}`}
        </footer>
      </div>
    );
  };

  const getItemTypeColor = (type: InventoryItem['type']) => {
    switch (type) {
      case 'element': return '#6366f1';
      case 'site_signature': return '#10b981';
      case 'interaction': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <div>Loading PlayHTML Bag...</div>
      </div>
    );
  }

  if (currentView === 'inventory') {
    return renderInventoryView();
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
              onClick={() => setCurrentView('inventory')}
              style={{
                padding: "8px 12px",
                background: "#8b5cf6",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              View Inventory ({inventory.totalItems})
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
