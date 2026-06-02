// ABOUTME: Standalone cursor color editor for native browser color picking.
// ABOUTME: Runs in a real extension window so Firefox does not close toolbar popup state.

import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import { CursorSvg } from "./icons";
import { savePlayerColor } from "../storage/playerColor";
import type { PlayerIdentity } from "../types";
import "./ColorPickerPage.scss";

export function ColorPickerPage() {
  const [color, setColor] = useState("#4a9a8a");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasIdentity, setHasIdentity] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { playerIdentity } = await browser.storage.local.get([
          "playerIdentity",
        ]);
        const identity = playerIdentity as PlayerIdentity | undefined;
        const storedColor = identity?.playerStyle?.colorPalette?.[0];
        if (storedColor) setColor(storedColor);
        setHasIdentity(Boolean(identity));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePlayerColor(color);
      window.close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="color-picker-page">
      <header className="color-picker-page__header">
        <h1 className="color-picker-page__title">Cursor color</h1>
      </header>

      <section className="color-picker-page__body">
        <div className="color-picker-page__preview" aria-hidden="true">
          <CursorSvg size={52} color={color} />
        </div>
        <label className="color-picker-page__field">
          <span className="color-picker-page__label">Color</span>
          <input
            type="color"
            value={color}
            onInput={(e) => setColor(e.currentTarget.value)}
            onChange={(e) => setColor(e.currentTarget.value)}
            disabled={loading || !hasIdentity}
            className="color-picker-page__input"
          />
        </label>
      </section>

      <footer className="color-picker-page__actions">
        <button
          type="button"
          onClick={() => window.close()}
          className="color-picker-page__cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          aria-label="Save cursor color"
          onClick={handleSave}
          disabled={loading || saving || !hasIdentity}
          className="color-picker-page__save"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </footer>
    </main>
  );
}
