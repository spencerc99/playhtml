import React, { useState, useEffect } from "react";
import browser from "webextension-polyfill";
import type { CollectorStatus } from "../collectors/types";

interface CollectionsProps {
  onBack: () => void;
}

export function Collections({ onBack }: CollectionsProps) {
  const [collectors, setCollectors] = useState<CollectorStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCollectors();
  }, []);

  const loadCollectors = async () => {
    try {
      // Request collector statuses from content script
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        throw new Error("No active tab found");
      }

      // Check if tab URL is accessible (not chrome:// or extension://)
      if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("moz-extension://"))) {
        throw new Error("Content script not available on this page");
      }

      const response = await browser.tabs.sendMessage(tab.id, {
        type: "GET_COLLECTOR_STATUSES",
      });

      if (response && Array.isArray(response.statuses) && response.statuses.length > 0) {
        setCollectors(response.statuses);
      } else if (response?.error) {
        console.warn("Collector manager not initialized:", response.error);
        // Fallback to default collectors
        setCollectors([
          {
            type: "cursor",
            enabled: false,
            description: "Captures cursor movement, clicks, holds, and cursor style changes",
          },
        ]);
      } else {
        // No collectors registered yet, show default
        setCollectors([
          {
            type: "cursor",
            enabled: false,
            description: "Captures cursor movement, clicks, holds, and cursor style changes",
          },
        ]);
      }
      setError(null);
    } catch (error: any) {
      console.error("Failed to load collectors:", error);
      setError("Unable to connect to content script. Make sure you're on a regular webpage (not chrome:// pages).");
      // Fallback to default collectors
      setCollectors([
        {
          type: "cursor",
          enabled: false,
          description: "Captures cursor movement, clicks, hovers, drags, and zoom",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCollector = async (type: string, enabled: boolean) => {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        console.error("No active tab found");
        return;
      }

      // Optimistically update UI
      setCollectors((prev) =>
        prev.map((c) => (c.type === type ? { ...c, enabled } : c))
      );

      // Send message and wait for response
      const response = await browser.tabs.sendMessage(tab.id, {
        type: enabled ? "ENABLE_COLLECTOR" : "DISABLE_COLLECTOR",
        collectorType: type,
      });

      if (response && !response.success) {
        console.error("Failed to toggle collector:", response.error);
        // Revert optimistic update
        setCollectors((prev) =>
          prev.map((c) => (c.type === type ? { ...c, enabled: !enabled } : c))
        );
        alert(`Failed to ${enabled ? "enable" : "disable"} collector: ${response.error || "Unknown error"}`);
      } else {
        // Reload collector statuses to ensure sync
        await loadCollectors();
      }
    } catch (error) {
      console.error("Failed to toggle collector:", error);
      // Revert optimistic update
      setCollectors((prev) =>
        prev.map((c) => (c.type === type ? { ...c, enabled: !enabled } : c))
      );
      alert(`Failed to toggle collector. Make sure you're on a webpage (not chrome:// pages).`);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <div>Loading collections...</div>
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "18px",
              marginRight: "8px",
              padding: "0",
            }}
          >
            ←
          </button>
          <h1
            style={{
              margin: 0,
              fontSize: "18px",
              color: "#1f2937",
            }}
          >
            Collections
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: "12px", color: "#6b7280" }}>
          Participate in collective internet artworks
        </p>
      </header>

      <main style={{ flex: 1, overflow: "auto" }}>
        {error && (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px",
              background: "#fee2e2",
              borderRadius: "8px",
              fontSize: "12px",
              color: "#991b1b",
            }}
          >
            <strong>⚠️ {error}</strong>
            <br />
            <span style={{ fontSize: "11px" }}>
              Try refreshing the page or navigating to a regular website.
            </span>
          </div>
        )}
        <div
          style={{
            marginBottom: "16px",
            padding: "12px",
            background: "#f3f4f6",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#4b5563",
          }}
        >
          <strong>Participating in:</strong> Internet Movement
          <br />
          <span style={{ fontSize: "11px", color: "#6b7280" }}>
            Your browsing behaviors contribute to evolving artworks
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {collectors.map((collector) => (
            <div
              key={collector.type}
              style={{
                padding: "12px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                background: collector.enabled ? "#f0fdf4" : "#ffffff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "4px",
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        fontWeight: "600",
                        color: "#1f2937",
                        textTransform: "capitalize",
                      }}
                    >
                      {collector.type}
                    </h3>
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: collector.enabled
                          ? "#10b981"
                          : "#9ca3af",
                        color: "white",
                      }}
                    >
                      {collector.enabled ? "Active" : "Paused"}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "12px",
                      color: "#6b7280",
                    }}
                  >
                    {collector.description}
                  </p>
                </div>
                <label
                  style={{
                    position: "relative",
                    display: "inline-block",
                    width: "44px",
                    height: "24px",
                    marginLeft: "12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={collector.enabled}
                    onChange={(e) =>
                      toggleCollector(collector.type, e.target.checked)
                    }
                    style={{
                      opacity: 0,
                      width: 0,
                      height: 0,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      cursor: "pointer",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: collector.enabled
                        ? "#10b981"
                        : "#d1d5db",
                      transition: "0.3s",
                      borderRadius: "24px",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        content: '""',
                        height: "18px",
                        width: "18px",
                        left: collector.enabled ? "22px" : "3px",
                        bottom: "3px",
                        backgroundColor: "white",
                        transition: "0.3s",
                        borderRadius: "50%",
                      }}
                    />
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            background: "#fef3c7",
            borderRadius: "8px",
            fontSize: "11px",
            color: "#92400e",
          }}
        >
          <strong>Privacy:</strong> All data is anonymous. No personal
          information is collected. You can pause collection anytime.
        </div>
      </main>
    </div>
  );
}
