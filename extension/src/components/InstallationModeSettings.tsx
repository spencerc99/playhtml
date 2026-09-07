// ABOUTME: Reveals a local installation cursor setting through a settings-only shortcut.
// ABOUTME: Keeps the control visible while enabled and reports storage failures.

import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { INSTALLATION_MODE_KEY } from "../features/installationMode";

export function InstallationModeSettings() {
  const [revealed, setRevealed] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let changed = false;
    const onStorage = (
      changes: Record<string, browser.Storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local" || !changes[INSTALLATION_MODE_KEY]) return;
      changed = true;
      setEnabled(changes[INSTALLATION_MODE_KEY].newValue === true);
    };
    browser.storage.onChanged.addListener(onStorage);
    void browser.storage.local
      .get(INSTALLATION_MODE_KEY)
      .then((stored) => {
        if (!active) return;
        if (!changed) setEnabled(stored[INSTALLATION_MODE_KEY] === true);
        setReady(true);
      })
      .catch(() => {
        if (active) setError(true);
      });

    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.code !== "Digit8" ||
        event.repeat
      )
        return;
      event.preventDefault();
      setRevealed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onStorage);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!revealed && !enabled) return null;

  return (
    <div className="options-page__setting-row">
      <div>
        <h2>Installation mode</h2>
        <p>
          Show your own colored cursor on web pages. Stays on until you turn it
          off.
        </p>
        {error && (
          <p role="alert">
            Could not save or load installation mode. Reopen Settings to try
            again.
          </p>
        )}
      </div>
      <input
        type="checkbox"
        aria-label="Installation mode"
        checked={enabled}
        disabled={!ready || saving}
        onChange={async (event) => {
          const checked = event.target.checked;
          setEnabled(checked);
          setRevealed(true);
          setSaving(true);
          setError(false);
          try {
            await browser.storage.local.set({
              [INSTALLATION_MODE_KEY]: checked,
            });
          } catch {
            setEnabled(!checked);
            setError(true);
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
