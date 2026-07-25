// ABOUTME: Profile settings page showing identity info and cursor color picker
// ABOUTME: Accessed by clicking the cursor icon in the popup header
import React, { useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { PlayerIdentity } from "../types";
import { CursorSvg } from "./icons";
import { savePlayerColor } from "../storage/playerColor";
import "./ProfilePage.scss";
import { hslToHex } from "../utils/color";

interface Props {
  playerIdentity: PlayerIdentity;
  discoveredSites: string[];
  onBack: () => void;
  onIdentityUpdated: (identity: PlayerIdentity) => void;
}

function randomPrimaryColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 70, 60);
}

export function ProfilePage({
  playerIdentity,
  discoveredSites,
  onBack,
  onIdentityUpdated,
}: Props) {
  const savedColor = playerIdentity.playerStyle?.colorPalette?.[0] ?? "#4a9a8a";
  const [color, setColor] = useState(savedColor);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  // Firefox closes extension toolbar panels when an OS-level color picker opens.
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1378527
  const opensNativePickerInPopup = !import.meta.env.FIREFOX;

  const hasColorChanged = color !== savedColor;

  const commitColor = (nextColor: string) => {
    setColor(nextColor);
  };

  const handleOpenNativeColorPicker = async () => {
    await browser.windows.create({
      url: browser.runtime.getURL("color-picker.html"),
      type: "popup",
      width: 360,
      height: 260,
    });
    window.close();
  };

  const handleSaveColor = async () => {
    setSaving(true);
    try {
      const updated = await savePlayerColor(color);
      if (updated) onIdentityUpdated(updated);
    } catch {} finally {
      setSaving(false);
    }
  };

  const handleCopyPublicKey = async () => {
    try {
      await navigator.clipboard.writeText(playerIdentity.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const siteCount = discoveredSites.length;
  const truncatedKey = playerIdentity.publicKey.length > 20
    ? playerIdentity.publicKey.slice(0, 6) + "..." + playerIdentity.publicKey.slice(-6)
    : playerIdentity.publicKey;

  return (
    <div className="profile-page">
      <header className="profile-page__header">
        <button onClick={onBack} className="profile-page__back">← Back</button>
        <h2 className="profile-page__title">Profile</h2>
      </header>

      <main className="profile-page__main">
        {/* Cursor color section */}
        <section className="profile-section">
          <label className="profile-section__label">Cursor color</label>
          <div className="profile-section__color-row">
            {opensNativePickerInPopup ? (
              <>
                <input
                  ref={colorInputRef}
                  type="color"
                  value={color}
                  onChange={(e) => commitColor(e.target.value)}
                  className="profile-section__color-input--hidden"
                />
                <button
                  type="button"
                  aria-label="Pick cursor color"
                  title="Click to pick a color"
                  onClick={() => colorInputRef.current?.click()}
                  className="profile-section__cursor-preview"
                >
                  <CursorSvg size={36} color={color} />
                </button>
              </>
            ) : (
              <div
                className="profile-section__cursor-preview profile-section__cursor-preview--static"
                aria-hidden="true"
              >
                <CursorSvg size={36} color={color} />
              </div>
            )}
            <button
              type="button"
              aria-label="Re-roll color"
              title="Re-roll color"
              onClick={() => commitColor(randomPrimaryColor())}
              className="profile-section__reroll-btn"
            >
              ↻
            </button>
            {!opensNativePickerInPopup && (
              <button
                type="button"
                aria-label="Open native cursor color picker"
                title="Open native color picker"
                onClick={handleOpenNativeColorPicker}
                className="profile-section__picker-window-btn"
              >
                Choose
              </button>
            )}
            {hasColorChanged && (
              <button
                type="button"
                onClick={handleSaveColor}
                disabled={saving}
                className="profile-section__save-btn"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </section>

        {/* Identity section */}
        <section className="profile-section">
          <label className="profile-section__label">Public key</label>
          <div className="profile-section__key-row">
            <code className="profile-section__key-value">{truncatedKey}</code>
            <button
              type="button"
              onClick={handleCopyPublicKey}
              className="profile-section__copy-btn"
              title="Copy full public key"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>

        {/* Stats section */}
        <section className="profile-section">
          <label className="profile-section__label">Collection</label>
          <div className="profile-section__stats">
            {siteCount > 0 && (
              <div className="profile-section__stat">
                <span className="profile-section__stat-value">{siteCount}</span>
                <span className="profile-section__stat-label">
                  {siteCount === 1 ? "site discovered" : "sites discovered"}
                </span>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
