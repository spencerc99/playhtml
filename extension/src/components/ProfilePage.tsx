// ABOUTME: Profile settings for identity, cursor color, and early access requests.
// ABOUTME: Prefills locally shared contact email only when the person submits a request.
import React, { FormEvent, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import type { PlayerIdentity } from "../types";
import { CursorSvg } from "./icons";
import { savePlayerColor } from "../storage/playerColor";
import "./ProfilePage.scss";
import { hslToHex } from "../utils/color";
import { usePrivateExperimentAccess } from "../features/useFeatureAccess";

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
  const [betaEmail, setBetaEmail] = useState("");
  const [requestingBeta, setRequestingBeta] = useState(false);
  const [betaRequestStatus, setBetaRequestStatus] = useState<"idle" | "sent" | "error">("idle");
  const colorInputRef = useRef<HTMLInputElement>(null);
  const privateExperimentAccess = usePrivateExperimentAccess();
  // Firefox closes extension toolbar panels when an OS-level color picker opens.
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1378527
  const opensNativePickerInPopup = !import.meta.env.FIREFOX;

  const hasColorChanged = color !== savedColor;

  useEffect(() => {
    browser.storage.local.get("setup_email")
      .then((stored) => {
        if (typeof stored.setup_email === "string") setBetaEmail(stored.setup_email);
      })
      .catch(() => {});
  }, []);

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

  const handleBetaRequest = async (event: FormEvent) => {
    event.preventDefault();
    setRequestingBeta(true);
    setBetaRequestStatus("idle");
    try {
      const response = await fetch(`${WORKER_URL}/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicId: playerIdentity.publicKey,
          email: betaEmail.trim() || undefined,
          requestedFeatures: ["COMMUTE", "SCRAPS"],
        }),
      });
      if (!response.ok) throw new Error(`Access request failed with ${response.status}`);
      setBetaRequestStatus("sent");
    } catch {
      setBetaRequestStatus("error");
    } finally {
      setRequestingBeta(false);
    }
  };

  const siteCount = discoveredSites.length;
  const truncatedKey = playerIdentity.publicKey.length > 20
    ? playerIdentity.publicKey.slice(0, 6) + "..." + playerIdentity.publicKey.slice(-6)
    : playerIdentity.publicKey;

  return (
    <div className="profile-page">
      <header className="profile-page__header">
        <button onClick={onBack} className="profile-page__back">
          ← back
        </button>
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

        {!privateExperimentAccess && (
          <section className="profile-section profile-section--beta">
            <label className="profile-section__label" htmlFor="beta-email">Request early access</label>
            <p>Try new experimental features that make the internet feel more shared and alive. Experiments stay off until you choose to enable them.</p>
            {betaRequestStatus === "sent" ? (
              <strong className="profile-section__request-success">Request sent</strong>
            ) : (
              <form onSubmit={handleBetaRequest}>
                <input
                  id="beta-email"
                  type="email"
                  value={betaEmail}
                  onChange={(event) => setBetaEmail(event.target.value)}
                  placeholder="Email for a reply (optional)"
                  autoComplete="email"
                />
                <button type="submit" disabled={requestingBeta}>
                  {requestingBeta ? "Sending…" : "Request early access"}
                </button>
              </form>
            )}
            {betaRequestStatus === "error" && <small>Couldn’t send the request. Please try again.</small>}
          </section>
        )}

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
