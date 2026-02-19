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

const PRIVACY_LEVEL_KEY = 'collection_keyboard_privacy_level';
const FILTER_SUBSTRINGS_KEY = 'collection_keyboard_filter_substrings';

export function Collections({ onBack }: CollectionsProps) {
  const [collectors, setCollectors] = useState<CollectorStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyboardPrivacyLevel, setKeyboardPrivacyLevel] = useState<'abstract' | 'full'>('abstract');
  const [filterSubstrings, setFilterSubstrings] = useState<string[]>([]);
  const [newFilterSubstring, setNewFilterSubstring] = useState('');
  const [modes, setModes] = useState<Record<string, 'off' | 'local' | 'shared'>>({});

  useEffect(() => {
    loadCollectors();
    loadPrivacyLevel();
    loadFilterSubstrings();
    loadModes();
  }, []);

  const loadModes = async () => {
    try {
      const types = getValidEventTypes();
      const keys = types.map(t => `collection_mode_${t}`);
      const result = await browser.storage.local.get(keys);
      const next: Record<string, 'off' | 'local' | 'shared'> = {};
      for (const t of types) {
        const val = result[`collection_mode_${t}`];
        next[t] = val === 'off' || val === 'shared' || val === 'local' ? val : 'local';
      }
      setModes(next);
      const toSet: Record<string, string> = {};
      for (const t of types) {
        if (!result[`collection_mode_${t}`]) toSet[`collection_mode_${t}`] = next[t];
      }
      if (Object.keys(toSet).length > 0) await browser.storage.local.set(toSet);
    } catch (e) {
      // ignore
    }
  };

  const updateMode = async (type: string, mode: 'off' | 'local' | 'shared') => {
    try {
      await browser.storage.local.set({ [`collection_mode_${type}`]: mode });
      setModes(prev => ({ ...prev, [type]: mode }));

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        if (mode === 'off') {
          await browser.tabs.sendMessage(tab.id, { type: 'DISABLE_COLLECTOR', collectorType: type });
        } else {
          await browser.tabs.sendMessage(tab.id, { type: 'ENABLE_COLLECTOR', collectorType: type });
        }
      }
    } catch (e) {
      alert('Failed to update mode. Please try again.');
    }
  };

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
      <div className="collections__loading">Loading collections...</div>
    );
  }

  return (
    <div className="collections">
      <header className="collections__header">
        <div className="back-row">
          <button onClick={onBack} className="back-btn">←</button>
          <h1>Data Collection Settings</h1>
        </div>
        <p>Control what's collected and whether it's shared</p>
      </header>

      <main className="collections__main">
        {error && (
          <div className="collections__error">
            <strong>△ {error}</strong>
            <br />
            <span>Try refreshing the page or navigating to a regular website.</span>
          </div>
        )}

        <div className="collections__context">
          <strong>Participating in:</strong> Internet Movement
          <br />
          <span>Your browsing behaviors contribute to evolving artworks</span>
        </div>

        <div className="collections__collector-list">
          {collectors.map((collector) => {
            const isActive = modes[collector.type] && modes[collector.type] !== 'off';
            return (
              <div
                key={collector.type}
                className={`collector-card${isActive ? " collector-card--active" : ""}`}
              >
                <div className="collector-card__header">
                  <div className="collector-card__info">
                    <div className="collector-card__title-row">
                      <h3 className="collector-card__name">{collector.type}</h3>
                      <span className={`collector-card__status-badge collector-card__status-badge--${isActive ? "active" : "paused"}`}>
                        {isActive ? "Active" : "Paused"}
                      </span>
                    </div>
                    <p className="collector-card__description">{collector.description}</p>
                  </div>
                  <div className="collector-card__modes">
                    {(['off', 'local', 'shared'] as const).map((opt) => (
                      <label key={opt}>
                        <input
                          type="radio"
                          name={`mode-${collector.type}`}
                          value={opt}
                          checked={(modes[collector.type] || 'local') === opt}
                          onChange={() => updateMode(collector.type, opt)}
                        />
                        {opt === 'local' ? 'Local only' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Privacy level sub-setting for keyboard collector */}
                {collector.type === 'keyboard' && isActive && (
                  <>
                    <div className="collector-card__privacy-section">
                      <div className="collector-card__privacy-header">
                        <div>
                          <label className="collector-card__privacy-label">Privacy Level</label>
                          <p className="collector-card__privacy-desc">
                            {keyboardPrivacyLevel === 'abstract'
                              ? 'Abstract: Typing frequency and location only (no text)'
                              : 'Full: Text content with PII redaction'}
                          </p>
                        </div>
                        <select
                          value={keyboardPrivacyLevel}
                          onChange={(e) => updatePrivacyLevel(e.target.value as 'abstract' | 'full')}
                          className="collector-card__privacy-select"
                        >
                          <option value="abstract">Abstract</option>
                          <option value="full">Full</option>
                        </select>
                      </div>
                    </div>

                    {/* Filter substrings section - only show when privacy level is 'full' */}
                    {keyboardPrivacyLevel === 'full' && (
                      <div className="collector-card__filter-section">
                        <label className="collector-card__filter-label">Filter Sensitive Text</label>
                        <p className="collector-card__filter-desc">
                          Sequences containing these substrings will be redacted
                        </p>
                        <div className="collector-card__filter-input-row">
                          <input
                            type="text"
                            value={newFilterSubstring}
                            onChange={(e) => setNewFilterSubstring(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') addFilterSubstring();
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
                                <button onClick={() => removeFilterSubstring(substring)}>×</button>
                              </div>
                            ))}
                          </div>
                        )}

                        {filterSubstrings.length === 0 && (
                          <p className="collector-card__filter-empty">No filters added yet</p>
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
          <strong>Privacy:</strong> All data is anonymous. No personal
          information is collected. You can pause collection anytime.
        </div>
      </main>
    </div>
  );
}
