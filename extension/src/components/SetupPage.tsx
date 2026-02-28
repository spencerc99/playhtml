// ABOUTME: Full-page setup wizard for first-time extension configuration
// ABOUTME: Handles data sharing consent and cursor color customization
import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { getValidEventTypes } from "../shared/types";
import { CursorSvg } from "./icons";
import { CollectorList } from "./Collections";
import { TrailsHero } from "./TrailsHero";
import "./SetupPage.scss";

type Step = "welcome" | "configure" | "done";
type SharingMode = "local" | "shared";
type CollectorMode = "off" | "local" | "shared";
type KeyboardFidelity = "abstract" | "full";

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

function defaultModesFor(mode: SharingMode): Record<string, CollectorMode> {
  const types = getValidEventTypes();
  const result: Record<string, CollectorMode> = {};
  for (const t of types) result[t] = mode;
  return result;
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>("welcome");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState<string>("");
  const [sharingMode, setSharingMode] = useState<SharingMode>("local");
  const [collectorModes, setCollectorModes] = useState<Record<string, CollectorMode>>(
    defaultModesFor("local"),
  );
  const [keyboardFidelity, setKeyboardFidelity] = useState<KeyboardFidelity>("full");
  const [keyboardFidelityOverridden, setKeyboardFidelityOverridden] = useState(false);
  const [busy, setBusy] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const update = () => setHeroSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { playerIdentity } = await browser.storage.local.get(["playerIdentity"]);
        if (playerIdentity) {
          const existing = playerIdentity.playerStyle?.colorPalette?.[0];
          if (existing && typeof existing === "string") setColor(existing);
          else setColor(randomPrimaryColor());
        } else {
          setColor(randomPrimaryColor());
        }
      } catch {
        setColor(randomPrimaryColor());
      }
    })();
  }, []);

  const handleSharingTabChange = (mode: SharingMode) => {
    setSharingMode(mode);
    setCollectorModes(defaultModesFor(mode));
    if (!keyboardFidelityOverridden) {
      setKeyboardFidelity(mode === "local" ? "full" : "abstract");
    }
  };

  const handleCollectorModeChange = (type: string, mode: CollectorMode) => {
    setCollectorModes((prev) => ({ ...prev, [type]: mode }));
  };

  const handleKeyboardFidelityChange = (fidelity: KeyboardFidelity) => {
    setKeyboardFidelity(fidelity);
    setKeyboardFidelityOverridden(true);
  };

  const applyConsent = async () => {
    setBusy(true);
    try {
      const types = getValidEventTypes();
      const toSet: Record<string, string> = {};
      for (const t of types) toSet[`collection_mode_${t}`] = collectorModes[t] || sharingMode;
      toSet["keyboard_display_mode"] = keyboardFidelity;
      toSet["onboarding_complete"] = "true";
      if (email.trim()) {
        toSet["setup_email"] = email.trim();
        // Submit to Google Form (fire-and-forget)
        const formUrl =
          "https://docs.google.com/forms/d/e/1FAIpQLSe6rJ8uAflDqE-B07E8hTEiPwsis8xEqX0-E_uTuUXwRrH0PA/formResponse";
        const body = new URLSearchParams({ "entry.1423870775": email.trim() });
        fetch(formUrl, { method: "POST", body, mode: "no-cors" }).catch(() => {});
      }

      await browser.storage.local.set(toSet);

      try {
        const { playerIdentity } = await browser.storage.local.get(["playerIdentity"]);
        if (playerIdentity) {
          if (!playerIdentity.playerStyle)
            playerIdentity.playerStyle = { colorPalette: [color] } as any;
          else {
            const palette = Array.isArray(playerIdentity.playerStyle.colorPalette)
              ? playerIdentity.playerStyle.colorPalette
              : [];
            palette[0] = color;
            playerIdentity.playerStyle.colorPalette = palette;
          }
          await browser.storage.local.set({ playerIdentity });
        }
      } catch {}

      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          for (const t of types) {
            if (collectorModes[t] !== "off") {
              await browser.tabs.sendMessage(tab.id, { type: "ENABLE_COLLECTOR", collectorType: t });
            }
          }
        }
      } catch {}

      setStep("done");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-step__trail-art" ref={heroRef} aria-hidden>
        <TrailsHero width={heroSize.width} height={heroSize.height} />
      </div>
      <div className="setup-page__inner">
        {step === "welcome" && (
          <section className="setup-step">
            <h1 className="setup-step__title">we were online</h1>
            <p className="setup-step__desc">
              This extension quietly records how you move through the internet —
              your cursor trails, reading rhythm, time on pages — and turns it
              into a living portrait of your digital presence. You choose how it's used.
            </p>
            <div className="setup-step__field">
              <label className="setup-step__field-label">Email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="for updates & feedback"
                className="setup-step__input"
              />
            </div>
            <button onClick={() => setStep("configure")} className="setup-step__btn-primary">
              Get started
            </button>
          </section>
        )}

        {step === "configure" && (
          <section className="setup-step">
            <h2 className="setup-step__heading">How should we collect?</h2>

            <div className="setup-step__tabs">
              <button
                className={`setup-step__tab${sharingMode === "local" ? " setup-step__tab--active" : ""}`}
                onClick={() => handleSharingTabChange("local")}
              >
                Keep local
              </button>
              <button
                className={`setup-step__tab${sharingMode === "shared" ? " setup-step__tab--active" : ""}`}
                onClick={() => handleSharingTabChange("shared")}
              >
                Share anonymously
              </button>
            </div>

            {/* Reuse the same collector card UI from the settings page */}
            <CollectorList
              modes={collectorModes}
              onModeChange={handleCollectorModeChange}
              keyboardPrivacyLevel={keyboardFidelity}
              onKeyboardPrivacyChange={handleKeyboardFidelityChange}
            />

            <div className="setup-step__color-section">
              <label className="setup-step__field-label">Cursor color</label>
              <div className="setup-step__color-picker-row">
                {/* Hidden native color input — triggered by clicking the cursor preview */}
                <input
                  ref={colorInputRef}
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="setup-step__color-input--hidden"
                />
                <button
                  type="button"
                  aria-label="Pick cursor color"
                  title="Click to pick a color"
                  onClick={() => colorInputRef.current?.click()}
                  className="setup-step__cursor-preview"
                >
                  <CursorSvg size={36} color={color} />
                </button>
                <button
                  type="button"
                  aria-label="Re-roll color"
                  title="Re-roll color"
                  onClick={() => setColor(randomPrimaryColor())}
                  className="setup-step__reroll-btn"
                >
                  ↻
                </button>
              </div>
            </div>

            <div className="setup-step__actions">
              <button onClick={() => setStep("welcome")} className="setup-step__btn-secondary">
                Back
              </button>
              <button onClick={applyConsent} className="setup-step__btn-primary" disabled={busy}>
                Let's go
              </button>
            </div>
          </section>
        )}

        {step === "done" && (
          <section className="setup-step">
            <h2 className="setup-step__heading">All set!</h2>
            <p className="setup-step__desc">
              You can close this tab and open the popup to explore your portrait.
            </p>
            <div className="setup-step__actions">
              <button onClick={() => window.close()} className="setup-step__btn-primary">
                Close
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
