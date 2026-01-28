import React, { useState, useEffect } from "react";
import browser from "webextension-polyfill";
import type { CollectorStatus } from "../collectors/types";

interface CollectionsProps {
  onBack: () => void;
}

const PRIVACY_LEVEL_KEY = 'collection_keyboard_privacy_level';
const FILTER_SUBSTRINGS_KEY = 'collection_keyboard_filter_substrings';

export function Collections({ onBack }: CollectionsProps) {
  const [collectors, setCollectors] = useState<CollectorStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyboardPrivacyLevel, setKeyboardPrivacyLevel] = useState<'abstract' | 'full'>('abstract');
  const [filterSubstrings, setFilterSubstrings] = useState<string[]>([]);
  const [newFilterSubstring, setNewFilterSubstring] = useState('');

  useEffect(() => {
    loadCollectors();
    loadPrivacyLevel();
    loadFilterSubstrings();
  }, []);

  const loadPrivacyLevel = async () => {
    try {
      const result = await browser.storage.local.get([PRIVACY_LEVEL_KEY]);
      const level = result[PRIVACY_LEVEL_KEY];
      if (level === 'abstract' || level === 'full') {
        setKeyboardPrivacyLevel(level);
      } else {
        // Default to abstract if not set
        setKeyboardPrivacyLevel('abstract');
        await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: 'abstract' });
      }
    } catch (error) {
      console.error('Failed to load privacy level:', error);
      setKeyboardPrivacyLevel('abstract');
    }
  };

  const updatePrivacyLevel = async (level: 'abstract' | 'full') => {
    try {
      await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: level });
      setKeyboardPrivacyLevel(level);
      // Reload collectors to ensure the change is reflected
      await loadCollectors();
    } catch (error) {
      console.error('Failed to update privacy level:', error);
      alert('Failed to update privacy level. Please try again.');
    }
  };

  const loadFilterSubstrings = async () => {
    try {
      const result = await browser.storage.local.get([FILTER_SUBSTRINGS_KEY]);
      const substrings = result[FILTER_SUBSTRINGS_KEY];
      if (Array.isArray(substrings)) {
        setFilterSubstrings(substrings);
      } else {
        // Default to empty array if not set
        setFilterSubstrings([]);
        await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: [] });
      }
    } catch (error) {
      console.error('Failed to load filter substrings:', error);
      setFilterSubstrings([]);
    }
  };

  const addFilterSubstring = async () => {
    const trimmed = newFilterSubstring.trim();
    if (!trimmed) {
      alert('Please enter a substring to filter');
      return;
    }

    if (filterSubstrings.includes(trimmed)) {
      alert('This substring is already in the filter list');
      return;
    }

    try {
      const updated = [...filterSubstrings, trimmed];
      await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: updated });
      setFilterSubstrings(updated);
      setNewFilterSubstring('');
    } catch (error) {
      console.error('Failed to add filter substring:', error);
      alert('Failed to add filter substring. Please try again.');
    }
  };

  const removeFilterSubstring = async (substring: string) => {
    try {
      const updated = filterSubstrings.filter(s => s !== substring);
      await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: updated });
      setFilterSubstrings(updated);
    } catch (error) {
      console.error('Failed to remove filter substring:', error);
      alert('Failed to remove filter substring. Please try again.');
    }
  };

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
              {/* Privacy level sub-setting for keyboard collector */}
              {collector.type === 'keyboard' && collector.enabled && (
                <>
                  <div
                    style={{
                      marginTop: "12px",
                      paddingTop: "12px",
                      borderTop: "1px solid #e5e7eb",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <label
                          style={{
                            fontSize: "12px",
                            fontWeight: "500",
                            color: "#374151",
                            display: "block",
                            marginBottom: "4px",
                          }}
                        >
                          Privacy Level
                        </label>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "11px",
                            color: "#6b7280",
                          }}
                        >
                          {keyboardPrivacyLevel === 'abstract'
                            ? 'Abstract: Typing frequency and location only (no text)'
                            : 'Full: Text content with PII redaction'}
                        </p>
                      </div>
                      <select
                        value={keyboardPrivacyLevel}
                        onChange={(e) =>
                          updatePrivacyLevel(e.target.value as 'abstract' | 'full')
                        }
                        style={{
                          padding: "6px 12px",
                          fontSize: "12px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          backgroundColor: "white",
                          color: "#374151",
                          cursor: "pointer",
                          minWidth: "100px",
                        }}
                      >
                        <option value="abstract">Abstract</option>
                        <option value="full">Full</option>
                      </select>
                    </div>
                  </div>

                  {/* Filter substrings section - only show when privacy level is 'full' */}
                  {keyboardPrivacyLevel === 'full' && (
                    <div
                      style={{
                        marginTop: "12px",
                        paddingTop: "12px",
                        borderTop: "1px solid #e5e7eb",
                      }}
                    >
                      <label
                        style={{
                          fontSize: "12px",
                          fontWeight: "500",
                          color: "#374151",
                          display: "block",
                          marginBottom: "4px",
                        }}
                      >
                        Filter Sensitive Text
                      </label>
                      <p
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: "11px",
                          color: "#6b7280",
                        }}
                      >
                        Sequences containing these substrings will be redacted
                      </p>

                      {/* Add new filter input */}
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginBottom: "8px",
                        }}
                      >
                        <input
                          type="text"
                          value={newFilterSubstring}
                          onChange={(e) => setNewFilterSubstring(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              addFilterSubstring();
                            }
                          }}
                          placeholder="Enter substring..."
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            fontSize: "12px",
                            border: "1px solid #d1d5db",
                            borderRadius: "4px",
                            outline: "none",
                          }}
                        />
                        <button
                          onClick={addFilterSubstring}
                          style={{
                            padding: "6px 12px",
                            fontSize: "12px",
                            backgroundColor: "#10b981",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "500",
                          }}
                        >
                          Add
                        </button>
                      </div>

                      {/* Display current filters */}
                      {filterSubstrings.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                          }}
                        >
                          {filterSubstrings.map((substring) => (
                            <div
                              key={substring}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 8px",
                                backgroundColor: "#fee2e2",
                                color: "#991b1b",
                                borderRadius: "4px",
                                fontSize: "11px",
                              }}
                            >
                              <span>{substring}</span>
                              <button
                                onClick={() => removeFilterSubstring(substring)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#991b1b",
                                  cursor: "pointer",
                                  fontSize: "14px",
                                  padding: "0",
                                  lineHeight: 1,
                                  fontWeight: "bold",
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {filterSubstrings.length === 0 && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: "11px",
                            color: "#9ca3af",
                            fontStyle: "italic",
                          }}
                        >
                          No filters added yet
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
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
