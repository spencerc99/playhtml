// ABOUTME: Data collection settings screen for managing collector modes (off/local/shared)
// ABOUTME: Also handles keyboard privacy level and filter substring settings

import React, { useState, useEffect, useRef } from "react";
import browser from "webextension-polyfill";
import type { CollectorStatus } from "../collectors/types";
import { getValidEventTypes } from "../shared/types";
import { CollectorIcon } from "./icons";
import { triggerDownload } from "../utils/portraitExport";
import "./Collections.scss";

interface CollectionsProps {
  onBack: () => void;
}

const PRIVACY_LEVEL_KEY = "collection_keyboard_privacy_level";
const FILTER_SUBSTRINGS_KEY = "collection_keyboard_filter_substrings";
const DEV_MODE_KEY = "dev_mode";

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

// ── Shared collector list UI ──────────────────────────────────────────────────
// Renders collector cards with off/local/shared radio controls and the keyboard
// privacy level sub-setting. Used by both Collections and SetupPage.

export interface CollectorListProps {
  modes: Record<string, "off" | "local" | "shared">;
  onModeChange: (type: string, mode: "off" | "local" | "shared") => void;
  keyboardPrivacyLevel: "abstract" | "full";
  onKeyboardPrivacyChange: (level: "abstract" | "full") => void;
}

const COLLECTOR_DESCRIPTIONS: Record<string, string> = {
  cursor: "Captures cursor movement, clicks, holds, and cursor style changes",
  keyboard: "Captures typing frequency and location",
  viewport: "Captures scroll position and viewport changes",
  navigation: "Captures page navigation and session timing",
};

// ── Keyboard privacy preview ─────────────────────────────────────────────────
// Shows a before/after so users can see what "abstract" vs "full" actually
// records. The sample contains an email so the PII redaction in full mode
// is visible, not just abstract's opaque solid blocks.

const SAMPLE_TYPED_TEXT = "email hi@spencer.place with feedback!";
const REDACTION_CHAR = "\u2588"; // U+2588 FULL BLOCK — matches KeyboardCollector

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE =
  /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

function redactPII(text: string): string {
  let out = text;
  for (const re of [EMAIL_RE, PHONE_RE, SSN_RE]) {
    out = out.replace(re, (m) => REDACTION_CHAR.repeat(m.length));
  }
  return out;
}

function redactNonWhitespace(text: string): string {
  return text.replace(/\S/g, REDACTION_CHAR);
}

function KeyboardPrivacyPreview({ level }: { level: "abstract" | "full" }) {
  const output =
    level === "abstract"
      ? redactNonWhitespace(SAMPLE_TYPED_TEXT)
      : redactPII(SAMPLE_TYPED_TEXT);
  return (
    <div className="collector-card__privacy-preview">
      <div className="collector-card__privacy-preview-row">
        <span className="collector-card__privacy-preview-label">You type</span>
        <span className="collector-card__privacy-preview-value">
          {SAMPLE_TYPED_TEXT}
        </span>
      </div>
      <div className="collector-card__privacy-preview-row">
        <span className="collector-card__privacy-preview-label">We record</span>
        <span className="collector-card__privacy-preview-value collector-card__privacy-preview-value--recorded">
          {output}
        </span>
      </div>
    </div>
  );
}

export function CollectorList({
  modes,
  onModeChange,
  keyboardPrivacyLevel,
  onKeyboardPrivacyChange,
}: CollectorListProps) {
  const types = getValidEventTypes();
  return (
    <div className="collections__collector-list">
      {types.map((type) => {
        const mode = modes[type] ?? "off";
        const isActive = mode !== "off";
        const modifier =
          mode === "shared"
            ? " collector-card--shared"
            : mode === "local"
              ? " collector-card--local"
              : "";
        return (
          <div
            key={type}
            className={`collector-card${modifier}`}
          >
            <div className="collector-card__row">
              <div className="collector-card__title-row">
                <span aria-hidden className="collector-card__icon">
                  <CollectorIcon type={type} />
                </span>
                <h3 className="collector-card__name">{type}</h3>
              </div>
              <div className="collector-card__modes">
                {(["off", "local", "shared"] as const).map((opt) => (
                  <label key={opt}>
                    <input
                      type="radio"
                      name={`mode-${type}`}
                      value={opt}
                      checked={(modes[type] ?? "local") === opt}
                      onChange={() => onModeChange(type, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <p className="collector-card__description">
              {COLLECTOR_DESCRIPTIONS[type] ?? ""}
            </p>
            {type === "keyboard" && isActive && (
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
                      onKeyboardPrivacyChange(
                        e.target.value as "abstract" | "full",
                      )
                    }
                    className="collector-card__privacy-select"
                  >
                    <option value="abstract">Abstract</option>
                    <option value="full">Full</option>
                  </select>
                </div>
                <KeyboardPrivacyPreview level={keyboardPrivacyLevel} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
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
  const [devMode, setDevMode] = useState(false);
  const [transferStatus, setTransferStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCollectors();
    loadPrivacyLevel();
    loadFilterSubstrings();
    loadModes();
    loadStorageStats();
    loadDevMode();
  }, []);

  const loadDevMode = async () => {
    try {
      const result = await browser.storage.local.get([DEV_MODE_KEY]);
      setDevMode(Boolean(result[DEV_MODE_KEY]));
    } catch {
      setDevMode(false);
    }
  };

  const toggleDevMode = async (enabled: boolean) => {
    try {
      await browser.storage.local.set({ [DEV_MODE_KEY]: enabled });
      setDevMode(enabled);
    } catch (e) {
      console.error("Failed to update dev mode:", e);
    }
  };

  const clearAllData = async () => {
    if (
      !window.confirm(
        "Delete all locally stored events? This cannot be undone.",
      )
    )
      return;
    try {
      const response = await browser.runtime.sendMessage({
        type: "CLEAR_ALL_EVENTS",
      });
      if (response?.success) {
        setStorageStats(null);
      } else {
        alert("Failed to clear data. Please try again.");
      }
    } catch {
      alert("Failed to clear data. Please try again.");
    }
  };

  const loadStorageStats = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_STORAGE_STATS",
      });
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

  const handleExport = async () => {
    setIsExporting(true);
    setTransferStatus(null);
    try {
      const response = await browser.runtime.sendMessage({
        type: "EXPORT_EVENTS",
      });
      if (!response?.success)
        throw new Error(response?.error ?? "Export failed");
      const blob = new Blob([new Uint8Array(response.data)], {
        type: "application/gzip",
      });
      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `we-were-online-export-${date}.json.gz`);
      setTransferStatus({ type: "success", message: "Export downloaded." });
    } catch (e: any) {
      setTransferStatus({
        type: "error",
        message: `Export failed: ${e.message}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setTransferStatus(null);
    try {
      const buffer = await file.arrayBuffer();
      const data = Array.from(new Uint8Array(buffer));
      const response = await browser.runtime.sendMessage({
        type: "IMPORT_EVENTS",
        data,
      });
      if (!response?.success)
        throw new Error(response?.error ?? "Import failed");
      setTransferStatus({
        type: "success",
        message: `Imported ${response.imported.toLocaleString()} events.`,
      });
      await loadStorageStats();
    } catch (e: any) {
      setTransferStatus({
        type: "error",
        message: `Import failed: ${e.message}`,
      });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
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
        <p className="collections__header-desc">
          Control what's collected and whether it's shared
        </p>
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
          {Object.values(modes).some((m) => m === "shared") ? (
            <>
              <strong>Participating in</strong>{" "}
              <a
                href="https://spencer.place/creation/internet-movement"
                target="_blank"
                rel="noreferrer"
                className="collections__context-link"
              >
                Internet Movement
              </a>
              <br />
              <span>
                Thank you for contributing to a living, collective portrait of
                the internet.
              </span>
            </>
          ) : (
            <>
              <strong>Not participating in</strong>{" "}
              <a
                href="https://spencer.place/creation/internet-movement"
                target="_blank"
                rel="noreferrer"
                className="collections__context-link"
              >
                Internet Movement
              </a>
              <br />
              <span>Your browsing data is only staying local.</span>
            </>
          )}
        </div>

        <CollectorList
          modes={modes}
          onModeChange={updateMode}
          keyboardPrivacyLevel={keyboardPrivacyLevel}
          onKeyboardPrivacyChange={updatePrivacyLevel}
        />

        {/* Filter substrings — only when keyboard is active and full fidelity */}
        {(modes["keyboard"] ?? "local") !== "off" &&
          keyboardPrivacyLevel === "full" && (
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
                  onChange={(e) => setNewFilterSubstring(e.target.value)}
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
                    <div key={substring} className="collector-card__filter-tag">
                      <span>{substring}</span>
                      <button onClick={() => removeFilterSubstring(substring)}>
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

        <div className="collections__privacy-notice">
          {keyboardPrivacyLevel === "full" &&
          (modes["keyboard"] ?? "local") !== "off" ? (
            <>
              Keyboard full-fidelity mode records typed text. Use filters above
              to redact sensitive content. All other data is anonymous.{" "}
              <a href="mailto:hi@spencer.place">hi@spencer.place</a>
            </>
          ) : (
            <>
              All data is anonymous & no personal info is collected. Pause
              collection anytime. Questions?{" "}
              <a href="mailto:hi@spencer.place">hi@spencer.place</a>
            </>
          )}
        </div>

        <div className="collections__transfer">
          <div className="collections__transfer-buttons">
            <button
              className="collections__transfer-btn"
              onClick={handleExport}
              disabled={isExporting || isImporting}
            >
              {isExporting ? "Exporting…" : "Export data"}
            </button>
            <button
              className="collections__transfer-btn"
              onClick={() => importInputRef.current?.click()}
              disabled={isExporting || isImporting}
            >
              {isImporting ? "Importing…" : "Import data"}
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json.gz"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
            }}
          />
          {transferStatus && (
            <p
              className={`collections__transfer-status collections__transfer-status--${transferStatus.type}`}
            >
              {transferStatus.message}
            </p>
          )}
        </div>

        <button className="collections__clear-btn" onClick={clearAllData}>
          Clear all local data
        </button>

        <div className="collections__dev-mode">
          <label className="collections__dev-mode-label">
            <input
              type="checkbox"
              checked={devMode}
              onChange={(e) => toggleDevMode(e.target.checked)}
              className="collections__dev-mode-checkbox"
            />
            <div>
              <span className="collections__dev-mode-title">
                Developer mode
              </span>
              <span className="collections__dev-mode-desc">
                Shows advanced controls in the movement overlay
              </span>
            </div>
          </label>
        </div>
      </main>
    </div>
  );
}
