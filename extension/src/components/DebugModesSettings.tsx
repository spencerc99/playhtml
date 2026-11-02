// ABOUTME: Popup switches for developer debug overlays, shown only while developer mode is on.
// ABOUTME: Each switch writes one storage flag that open pages pick up without a reload.

import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { DEBUG_MODES, DEV_MODE_KEY } from "../features/debugModes/debugModes";

export function DebugModesSettings() {
  const [devMode, setDevMode] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const keys = [DEV_MODE_KEY, ...DEBUG_MODES.map((mode) => mode.storageKey)];
    browser.storage.local
      .get(keys)
      .then((stored) => {
        setDevMode(Boolean(stored[DEV_MODE_KEY]));
        setEnabled(
          Object.fromEntries(
            DEBUG_MODES.map((mode) => [mode.storageKey, Boolean(stored[mode.storageKey])]),
          ),
        );
      })
      .catch(() => setDevMode(false));
  }, []);

  if (!devMode) return null;

  const toggle = (storageKey: string, value: boolean) => {
    setEnabled((current) => ({ ...current, [storageKey]: value }));
    void browser.storage.local.set({ [storageKey]: value });
  };

  return (
    <section className="slow-mode-settings" aria-label="Debug modes">
      {DEBUG_MODES.map((mode) => (
        <div key={mode.id} className="slow-mode-settings__heading">
          <span>
            <strong>{mode.label}</strong>
            <small>{mode.description}</small>
          </span>
          <label className="slow-mode-toggle">
            <input
              type="checkbox"
              aria-label={`Show ${mode.label}`}
              checked={enabled[mode.storageKey] ?? false}
              onChange={(event) => toggle(mode.storageKey, event.target.checked)}
            />
            <span aria-hidden="true" />
          </label>
        </div>
      ))}
    </section>
  );
}
