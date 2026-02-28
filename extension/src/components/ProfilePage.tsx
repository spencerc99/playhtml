// ABOUTME: Profile settings page showing identity info and cursor color picker
// ABOUTME: Accessed by clicking the cursor icon in the popup header
import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { PlayerIdentity } from "../types";
import { CursorSvg } from "./icons";
import { syncParticipantColor } from "../storage/sync";
import { getParticipantId } from "../storage/participant";
import "./ProfilePage.scss";

interface Props {
  playerIdentity: PlayerIdentity;
  onBack: () => void;
  onIdentityUpdated: (identity: PlayerIdentity) => void;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = Math.min(
      1,
      Math.max(0, l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)),
    );
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function randomPrimaryColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 70, 60);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProfilePage({ playerIdentity, onBack, onIdentityUpdated }: Props) {
  const savedColor = playerIdentity.playerStyle?.colorPalette?.[0] ?? "#4a9a8a";
  const [color, setColor] = useState(savedColor);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storageStats, setStorageStats] = useState<{
    totalEvents: number;
    estimatedSizeBytes: number;
  } | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const hasColorChanged = color !== savedColor;

  useEffect(() => {
    (async () => {
      try {
        const response = await browser.runtime.sendMessage({ type: "GET_STORAGE_STATS" });
        if (response?.success && response.stats) {
          setStorageStats({
            totalEvents: response.stats.totalEvents ?? 0,
            estimatedSizeBytes: response.stats.estimatedSizeBytes ?? 0,
          });
        }
      } catch {}
    })();
  }, []);

  const handleSaveColor = async () => {
    setSaving(true);
    try {
      const { playerIdentity: stored } = await browser.storage.local.get(["playerIdentity"]);
      if (stored) {
        if (!stored.playerStyle) stored.playerStyle = { colorPalette: [color] };
        else {
          const palette = Array.isArray(stored.playerStyle.colorPalette)
            ? stored.playerStyle.colorPalette
            : [];
          palette[0] = color;
          stored.playerStyle.colorPalette = palette;
        }
        await browser.storage.local.set({ playerIdentity: stored });
        onIdentityUpdated(stored);

        // Sync to server
        try {
          const pid = await getParticipantId();
          await syncParticipantColor(pid, color);
        } catch {}
      }
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

  const siteCount = playerIdentity.discoveredSites?.length ?? 0;
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
            <input
              ref={colorInputRef}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
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
            <button
              type="button"
              aria-label="Re-roll color"
              title="Re-roll color"
              onClick={() => setColor(randomPrimaryColor())}
              className="profile-section__reroll-btn"
            >
              ↻
            </button>
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
            {storageStats && (
              <>
                <div className="profile-section__stat">
                  <span className="profile-section__stat-value">
                    {storageStats.totalEvents.toLocaleString()}
                  </span>
                  <span className="profile-section__stat-label">events stored</span>
                </div>
                <div className="profile-section__stat">
                  <span className="profile-section__stat-value">
                    ~{formatBytes(storageStats.estimatedSizeBytes)}
                  </span>
                  <span className="profile-section__stat-label">local data</span>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
