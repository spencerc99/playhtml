// ABOUTME: Data collection settings screen for managing collector modes (off/local/shared)
// ABOUTME: Also handles keyboard privacy level and filter substring settings

import React, { useState, useEffect } from "react";
import browser from "webextension-polyfill";
import type { CollectorStatus } from "../collectors/types";
import { getValidEventTypes } from "../shared/types";
import "./Collections.scss";

interface CollectionsProps {
  onBack: () => void;
}

function CollectorIcon({ type }: { type: string }) {
  if (type === "cursor")
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 32 32"
        fill="#3d3833"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" />
        <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" />
      </svg>
    );
  if (type === "keyboard")
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="3" y="7" width="18" height="10" rx="2" stroke="#3d3833" />
        <rect x="5" y="9" width="2" height="2" fill="#3d3833" />
        <rect x="8" y="9" width="2" height="2" fill="#3d3833" />
        <rect x="11" y="9" width="2" height="2" fill="#3d3833" />
        <rect x="14" y="9" width="2" height="2" fill="#3d3833" />
        <rect x="17" y="9" width="2" height="2" fill="#3d3833" />
        <rect x="5" y="12" width="10" height="2" fill="#3d3833" />
        <rect x="16" y="12" width="3" height="2" fill="#3d3833" />
      </svg>
    );
  if (type === "navigation")
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="#3d3833" />
        <circle cx="7" cy="8" r="1" fill="#3d3833" />
        <circle cx="10" cy="8" r="1" fill="#3d3833" />
        <rect
          x="5"
          y="10"
          width="14"
          height="7"
          fill="#efe9df"
          stroke="#efe9df"
        />
      </svg>
    );
  if (type === "viewport")
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="4" y="4" width="16" height="16" rx="2" stroke="#3d3833" />
        <rect x="17" y="6" width="2" height="12" rx="1" fill="#b5aea5" />
        <rect x="17" y="9" width="2" height="4" rx="1" fill="#3d3833" />
      </svg>
    );
  return null;
}

const PRIVACY_LEVEL_KEY = "collection_keyboard_privacy_level";
const FILTER_SUBSTRINGS_KEY = "collection_keyboard_filter_substrings";

interface StorageStats {
  totalEvents: number;
  estimatedSizeBytes: number;
  oldestEvent: number;
  countsByType: Record<string, number>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(ts: number): string {
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export function Collections({ onBack }: CollectionsProps) {
  const [collectors, setCollectors] = useState<CollectorStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyboardPrivacyLevel, setKeyboardPrivacyLevel] = useState<
    "abstract" | "full"
  >("abstract");
  const [filterSubstrings, setFilterSubstrings] = useState<string[]>([]);
  const [newFilterSubstring, setNewFilterSubstring] = useState("");
  const [modes, setModes] = useState<
    Record<string, "off" | "local" | "shared">
  >({});
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  useEffect(() => {
    loadCollectors();
    loadPrivacyLevel();
    loadFilterSubstrings();
    loadModes();
    loadStorageStats();
  }, []);

  const clearAllData = async () => {
    if (
      !window.confirm(
        "Delete all locally stored events? This cannot be undone.",
      )
    )
      return;
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        alert("No active tab found.");
        return;
      }
      const response = await browser.tabs.sendMessage(tab.id, {
        type: "CLEAR_ALL_EVENTS",
      });
      if (response?.success) {
        setStorageStats(null);
      } else {
        alert("Failed to clear data. Please try again.");
      }
    } catch {
      alert("Failed to clear data. Make sure you're on a regular webpage.");
    }
  };

  const loadStorageStats = async () => {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      const response = await browser.tabs.sendMessage(tab.id, {
        type: "GET_STORAGE_STATS",
      });
      console.log("response", response);
      if (response?.success && response.stats) {
        setStorageStats(response.stats);
      }
    } catch {
      // Non-fatal; stats pane just won't show
    }
  };

  const loadModes = async () => {
    try {
      const types = getValidEventTypes();
      const keys = types.map((t) => `collection_mode_${t}`);
      const result = await browser.storage.local.get(keys);
      const next: Record<string, "off" | "local" | "shared"> = {};
      for (const t of types) {
        const val = result[`collection_mode_${t}`];
        next[t] =
          val === "off" || val === "shared" || val === "local" ? val : "local";
      }
      setModes(next);
      const toSet: Record<string, string> = {};
      for (const t of types) {
        if (!result[`collection_mode_${t}`])
          toSet[`collection_mode_${t}`] = next[t];
      }
      if (Object.keys(toSet).length > 0) await browser.storage.local.set(toSet);
    } catch (e) {
      // ignore
    }
  };

  const updateMode = async (type: string, mode: "off" | "local" | "shared") => {
    try {
      await browser.storage.local.set({ [`collection_mode_${type}`]: mode });
      setModes((prev) => ({ ...prev, [type]: mode }));

      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        if (mode === "off") {
          await browser.tabs.sendMessage(tab.id, {
            type: "DISABLE_COLLECTOR",
            collectorType: type,
          });
        } else {
          await browser.tabs.sendMessage(tab.id, {
            type: "ENABLE_COLLECTOR",
            collectorType: type,
          });
        }
      }
    } catch (e) {
      alert("Failed to update mode. Please try again.");
    }
  };

  const loadPrivacyLevel = async () => {
    try {
      const result = await browser.storage.local.get([PRIVACY_LEVEL_KEY]);
      const level = result[PRIVACY_LEVEL_KEY];
      if (level === "abstract" || level === "full") {
        setKeyboardPrivacyLevel(level);
      } else {
        // Default to abstract if not set
        setKeyboardPrivacyLevel("abstract");
        await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: "abstract" });
      }
    } catch (error) {
      console.error("Failed to load privacy level:", error);
      setKeyboardPrivacyLevel("abstract");
    }
  };

  const updatePrivacyLevel = async (level: "abstract" | "full") => {
    try {
      await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: level });
      setKeyboardPrivacyLevel(level);
      // Reload collectors to ensure the change is reflected
      await loadCollectors();
    } catch (error) {
      console.error("Failed to update privacy level:", error);
      alert("Failed to update privacy level. Please try again.");
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
      console.error("Failed to load filter substrings:", error);
      setFilterSubstrings([]);
    }
  };

  const addFilterSubstring = async () => {
    const trimmed = newFilterSubstring.trim();
    if (!trimmed) {
      alert("Please enter a substring to filter");
      return;
    }

    if (filterSubstrings.includes(trimmed)) {
      alert("This substring is already in the filter list");
      return;
    }

    try {
      const updated = [...filterSubstrings, trimmed];
      await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: updated });
      setFilterSubstrings(updated);
      setNewFilterSubstring("");
    } catch (error) {
      console.error("Failed to add filter substring:", error);
      alert("Failed to add filter substring. Please try again.");
    }
  };

  const removeFilterSubstring = async (substring: string) => {
    try {
      const updated = filterSubstrings.filter((s) => s !== substring);
      await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: updated });
      setFilterSubstrings(updated);
    } catch (error) {
      console.error("Failed to remove filter substring:", error);
      alert("Failed to remove filter substring. Please try again.");
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
      if (
        tab.url &&
        (tab.url.startsWith("chrome://") ||
          tab.url.startsWith("chrome-extension://") ||
          tab.url.startsWith("moz-extension://"))
      ) {
        throw new Error("Content script not available on this page");
      }

      const response = await browser.tabs.sendMessage(tab.id, {
        type: "GET_COLLECTOR_STATUSES",
      });

      if (
        response &&
        Array.isArray(response.statuses) &&
        response.statuses.length > 0
      ) {
        setCollectors(response.statuses);
      } else if (response?.error) {
        console.warn("Collector manager not initialized:", response.error);
        // Fallback to default collectors
        setCollectors([
          {
            type: "cursor",
            enabled: false,
            description:
              "Captures cursor movement, clicks, holds, and cursor style changes",
          },
        ]);
      } else {
        // No collectors registered yet, show default
        setCollectors([
          {
            type: "cursor",
            enabled: false,
            description:
              "Captures cursor movement, clicks, holds, and cursor style changes",
          },
        ]);
      }
      setError(null);
    } catch (error: any) {
      console.error("Failed to load collectors:", error);
      setError(
        "Unable to connect to content script. Make sure you're on a regular webpage (not chrome:// pages).",
      );
      // Fallback to default collectors
      setCollectors([
        {
          type: "cursor",
          enabled: false,
          description:
            "Captures cursor movement, clicks, hovers, drags, and zoom",
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
        prev.map((c) => (c.type === type ? { ...c, enabled } : c)),
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
          prev.map((c) => (c.type === type ? { ...c, enabled: !enabled } : c)),
        );
        alert(
          `Failed to ${enabled ? "enable" : "disable"} collector: ${
            response.error || "Unknown error"
          }`,
        );
      } else {
        // Reload collector statuses to ensure sync
        await loadCollectors();
      }
    } catch (error) {
      console.error("Failed to toggle collector:", error);
      // Revert optimistic update
      setCollectors((prev) =>
        prev.map((c) => (c.type === type ? { ...c, enabled: !enabled } : c)),
      );
      alert(
        `Failed to toggle collector. Make sure you're on a webpage (not chrome:// pages).`,
      );
    }
  };

  if (isLoading) {
    return <div className="collections__loading">Loading collections...</div>;
  }

  return (
    <div className="collections">
      <header className="collections__header">
        <div className="back-row">
          <button onClick={onBack} className="back-btn">
            ←
          </button>
          <h1>Data Collection Settings</h1>
        </div>
        <p>Control what's collected and whether it's shared</p>
      </header>

      <main className="collections__main">
        {error && (
          <div className="collections__error">
            <strong>△ {error}</strong>
            <br />
            <span>
              Try refreshing the page or navigating to a regular website.
            </span>
          </div>
        )}

        {storageStats && storageStats.totalEvents > 0 && (
          <div className="collections__stats">
            <div className="collections__stat">
              <span className="collections__stat-value">
                {storageStats.totalEvents.toLocaleString()}
              </span>
              <span className="collections__stat-label">events</span>
            </div>
            <div className="collections__stat">
              <span className="collections__stat-value">
                {formatSize(storageStats.estimatedSizeBytes)}
              </span>
              <span className="collections__stat-label">stored</span>
            </div>
            {storageStats.oldestEvent > 0 && (
              <div className="collections__stat">
                <span className="collections__stat-value">
                  {formatAge(storageStats.oldestEvent)}
                </span>
                <span className="collections__stat-label">collecting</span>
              </div>
            )}
          </div>
        )}

        <div className="collections__context">
          <strong>Participating in:</strong> Internet Movement
          <br />
          <span>Your browsing behaviors contribute to evolving artworks</span>
        </div>

        <div className="collections__collector-list">
          {collectors.map((collector) => {
            const isActive =
              modes[collector.type] && modes[collector.type] !== "off";
            return (
              <div
                key={collector.type}
                className={`collector-card${
                  isActive ? " collector-card--active" : ""
                }`}
              >
                <div className="collector-card__row">
                  <div className="collector-card__title-row">
                    <span aria-hidden className="collector-card__icon">
                      <CollectorIcon type={collector.type} />
                    </span>
                    <h3 className="collector-card__name">{collector.type}</h3>
                    {storageStats?.countsByType[collector.type] != null && (
                      <span className="collector-card__count">
                        {storageStats.countsByType[
                          collector.type
                        ].toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="collector-card__modes">
                    {(["off", "local", "shared"] as const).map((opt) => (
                      <label key={opt}>
                        <input
                          type="radio"
                          name={`mode-${collector.type}`}
                          value={opt}
                          checked={(modes[collector.type] || "local") === opt}
                          onChange={() => updateMode(collector.type, opt)}
                        />
                        {opt === "local" ? "local" : opt}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="collector-card__description">
                  {collector.description}
                </p>

                {/* Privacy level sub-setting for keyboard collector */}
                {collector.type === "keyboard" && isActive && (
                  <>
                    <div className="collector-card__privacy-section">
                      <div className="collector-card__privacy-header">
                        <div>
                          <label className="collector-card__privacy-label">
                            Privacy Level
                          </label>
                          <p className="collector-card__privacy-desc">
                            {keyboardPrivacyLevel === "abstract"
                              ? "Abstract: Typing frequency and location only (no text)"
                              : "Full: Text content with PII redaction"}
                          </p>
                        </div>
                        <select
                          value={keyboardPrivacyLevel}
                          onChange={(e) =>
                            updatePrivacyLevel(
                              e.target.value as "abstract" | "full",
                            )
                          }
                          className="collector-card__privacy-select"
                        >
                          <option value="abstract">Abstract</option>
                          <option value="full">Full</option>
                        </select>
                      </div>
                    </div>

                    {/* Filter substrings section - only show when privacy level is 'full' */}
                    {keyboardPrivacyLevel === "full" && (
                      <div className="collector-card__filter-section">
                        <label className="collector-card__filter-label">
                          Filter Sensitive Text
                        </label>
                        <p className="collector-card__filter-desc">
                          Sequences containing these substrings will be redacted
                        </p>
                        <div className="collector-card__filter-input-row">
                          <input
                            type="text"
                            value={newFilterSubstring}
                            onChange={(e) =>
                              setNewFilterSubstring(e.target.value)
                            }
                            onKeyPress={(e) => {
                              if (e.key === "Enter") addFilterSubstring();
                            }}
                            placeholder="Enter substring..."
                          />
                          <button onClick={addFilterSubstring}>Add</button>
                        </div>

                        {filterSubstrings.length > 0 && (
                          <div className="collector-card__filter-tags">
                            {filterSubstrings.map((substring) => (
                              <div
                                key={substring}
                                className="collector-card__filter-tag"
                              >
                                <span>{substring}</span>
                                <button
                                  onClick={() =>
                                    removeFilterSubstring(substring)
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {filterSubstrings.length === 0 && (
                          <p className="collector-card__filter-empty">
                            No filters added yet
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="collections__privacy-notice">
          All data is anonymous — no personal information is collected. You can
          pause collection anytime. Questions?{" "}
          <a href="mailto:hi@spencer.place">hi@spencer.place</a>
        </div>

        <button className="collections__clear-btn" onClick={clearAllData}>
          Clear all local data
        </button>
      </main>
    </div>
  );
}
