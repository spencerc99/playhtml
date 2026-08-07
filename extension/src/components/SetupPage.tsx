// ABOUTME: Full-page setup wizard for first-time extension configuration
// ABOUTME: Handles consent choices, cursor color, and the three-step product tour
import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { getValidEventTypes } from "@playhtml/extension-types";
import { CursorSvg } from "./icons";
import { CollectorList } from "./Collections";
import { TrailsHero } from "./TrailsHero";
import { savePlayerColor } from "../storage/playerColor";
import { getPublicPlayerIdentity } from "../storage/playerIdentity";
import { LEGIBILITY_KEY } from "../utils/keyboardRedaction";
import "./SetupPage.scss";
import { hslToHex } from "../utils/color";
import { MilestoneToastPreview } from "./MilestoneToastPreview";

type Step = "welcome" | "configure" | "done";
type Preset = "abstain" | "participate" | "allIn";
type CollectorMode = "off" | "local" | "shared";

const SETUP_STEPS: Array<{ id: Step; label: string }> = [
  { id: "welcome", label: "welcome" },
  { id: "configure", label: "consent" },
  { id: "done", label: "complete" },
];

interface PresetConfig {
  label: string;
  subhead: string;
  description: string;
  modes: Record<string, CollectorMode>;
  legibilityPct: number;
  recommended?: boolean;
}

function randomPrimaryColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 70, 60);
}

function presetConfigs(): Record<Preset, PresetConfig> {
  const types = getValidEventTypes();
  const allLocal = (): Record<string, CollectorMode> => {
    const r: Record<string, CollectorMode> = {};
    for (const t of types) r[t] = "local";
    return r;
  };
  const allShared = (): Record<string, CollectorMode> => {
    const r: Record<string, CollectorMode> = {};
    for (const t of types) r[t] = "shared";
    return r;
  };
  return {
    abstain: {
      label: "Abstain",
      subhead: "Share nothing",
      description:
        "Nothing leaves this browser. Your portrait stays entirely local — a private record of your own wandering, including your full typing. You can change your mind anytime.",
      modes: allLocal(),
      legibilityPct: 100,
    },
    participate: {
      label: "Participate",
      subhead: "Share how I move",
      description:
        "Your full browsing movement joins the collective portrait — cursor trails, scroll rhythm, pages visited, and typing cadence. Typed text is partially redacted by default; you can make it more or less legible below.",
      modes: allShared(),
      legibilityPct: 50,
      recommended: true,
    },
    allIn: {
      label: "All-In",
      subhead: "Share everything",
      description:
        "Everything Participate shares, plus your typed text is fully legible (emails, phone numbers, and SSNs are still automatically redacted). You can tune legibility below.",
      modes: allShared(),
      legibilityPct: 100,
    },
  };
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>("welcome");
  const showDevStepNav = new URLSearchParams(window.location.search).has("dev");
  const [color, setColor] = useState<string>("");
  const presets = presetConfigs();
  const [preset, setPreset] = useState<Preset>("participate");
  const [collectorModes, setCollectorModes] = useState<
    Record<string, CollectorMode>
  >(presets.participate.modes);
  const [legibilityPct, setLegibilityPct] = useState<number>(
    presets.participate.legibilityPct,
  );
  const [customized, setCustomized] = useState(false);
  const [busy, setBusy] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const update = () =>
      setHeroSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const playerIdentity = await getPublicPlayerIdentity();
        if (playerIdentity) {
          const existing = playerIdentity.playerStyle.colorPalette[0];
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

  const handlePresetChange = (next: Preset) => {
    setPreset(next);
    setCollectorModes(presets[next].modes);
    setLegibilityPct(presets[next].legibilityPct);
    setCustomized(false);
  };

  const handleCollectorModeChange = (type: string, mode: CollectorMode) => {
    setCollectorModes((prev) => ({ ...prev, [type]: mode }));
    setCustomized(true);
  };

  const handleLegibilityChange = (pct: number) => {
    setLegibilityPct(Math.max(0, Math.min(100, Math.round(pct))));
    setCustomized(true);
  };

  const applyConsent = async () => {
    setBusy(true);
    try {
      const types = getValidEventTypes();
      const toSet: Record<string, unknown> = {};
      for (const t of types)
        toSet[`collection_mode_${t}`] = collectorModes[t] || "local";
      toSet[LEGIBILITY_KEY] = legibilityPct;

      await browser.storage.local.set(toSet);
      await savePlayerColor(color);
      setStep("done");
    } finally {
      setBusy(false);
    }
  };

  const finishOnboarding = async () => {
    setBusy(true);
    try {
      await browser.storage.local.set({ onboarding_complete: "true" });
      window.close();
    } finally {
      setBusy(false);
    }
  };

  const openExtensionPage = async (path: string) => {
    await browser.tabs.create({ url: browser.runtime.getURL(path) });
  };

  const presetOrder: Preset[] = ["abstain", "participate", "allIn"];

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
              into a living portrait of your digital presence. You choose how
              it's used.
            </p>
            <button
              onClick={() => setStep("configure")}
              className="setup-step__btn-primary"
            >
              Get started
            </button>
          </section>
        )}

        {step === "configure" && (
          <section className="setup-step">
            <h2 className="setup-step__heading">Personalize your portrait</h2>

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

            <h2 className="setup-step__heading">
              Do you want to participate in{" "}
              <a
                href="https://spencer.place/creation/internet-movement"
                target="_blank"
                rel="noreferrer"
                className="setup-step__heading-link"
              >
                Internet Movement
              </a>
              , a living, collective Internet portrait?
            </h2>

            <p className="setup-step__trust">
              Your data is anonymously collected, stewarded by Spencer, and will
              never be sold or shared for any other purpose without your
              permission.
            </p>

            <div className="setup-step__preset-tabs">
              {presetOrder.map((key) => {
                const p = presets[key];
                return (
                  <button
                    key={key}
                    className={
                      "setup-step__preset-tab" +
                      (preset === key ? " setup-step__preset-tab--active" : "")
                    }
                    onClick={() => handlePresetChange(key)}
                  >
                    <span className="setup-step__preset-label">{p.label}</span>
                    <span className="setup-step__preset-subhead">
                      {p.subhead}
                    </span>
                    {p.recommended && (
                      <span className="setup-step__preset-chip">
                        Recommended
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="setup-step__preset-description">
              {presets[preset].description}
              {customized && (
                <span className="setup-step__preset-customized">
                  {" "}
                  (customized)
                </span>
              )}
            </p>

            {/* Reuse the collector card UI from the settings page */}
            <CollectorList
              modes={collectorModes}
              onModeChange={handleCollectorModeChange}
              keyboardLegibilityPct={legibilityPct}
              onKeyboardLegibilityChange={handleLegibilityChange}
            />

            <div className="setup-step__actions">
              <button
                onClick={() => setStep("welcome")}
                className="setup-step__btn-secondary"
              >
                Back
              </button>
              <button
                onClick={applyConsent}
                className="setup-step__btn-primary"
                disabled={busy}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === "done" && (
          <section className="setup-step">
            <h2 className="setup-step__heading">All set!</h2>
            <p className="setup-step__desc">
              You can close this tab and open the popup to explore your
              portrait. A few things to know as you wander:
            </p>

            <div className="setup-step__tip">
              <h3 className="setup-step__subheading">See your trail, anywhere</h3>
              <p className="setup-step__desc">
                Press{" "}
                <kbd className="setup-step__kbd">
                  {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
                </kbd>
                <span className="setup-step__kbd-plus">+</span>
                <kbd className="setup-step__kbd">Shift</kbd>
                <span className="setup-step__kbd-plus">+</span>
                <kbd className="setup-step__kbd">H</kbd> on any page to bring up
                your historical overlay—the cursor trails, clicks, and scrolls
                you left there before.
              </p>
            </div>

            <div className="setup-step__tip">
              <h3 className="setup-step__subheading">Milestones along the way</h3>
              <p className="setup-step__desc">
                As you move, we'll drop the occasional note—marking miles
                walked, time spent, and places you keep returning to.
              </p>
              <MilestoneToastPreview />
            </div>

            <div className="setup-step__tip">
              <h3 className="setup-step__subheading">Review your browsing</h3>
              <p className="setup-step__desc">
                Every new tab reviews where your time went, the smaller places
                you explored, and a cursor portrait from each day. You can also
                open <strong>history</strong> from the popup.
              </p>
              <button
                type="button"
                onClick={() => void openExtensionPage("newtab.html")}
                className="setup-step__text-link"
              >
                Open history ↗
              </button>
            </div>

            <div className="setup-step__tip">
              <h3 className="setup-step__subheading">
                Wikipedia feels inhabited
              </h3>
              <p className="setup-step__desc">
                On Wikipedia, live cursors, article chat, remembered links, and
                shared trails turn reading into a place where you can cross
                paths with other visitors.
              </p>
              <div
                className="setup-step__wiki-preview"
                aria-label="Preview of live cursors on Wikipedia"
              >
                <div className="setup-step__wiki-address">
                  <strong>W</strong>
                  <span>en.wikipedia.org/wiki/Rabbit_hole</span>
                </div>
                <div className="setup-step__wiki-article">
                  <strong>Rabbit hole</strong>
                  <i />
                  <i />
                  <i className="setup-step__wiki-link" />
                  <span className="setup-step__wiki-cursor setup-step__wiki-cursor--one">
                    <CursorSvg size={14} color="#4a9a8a" />
                    <em>mira</em>
                  </span>
                  <span className="setup-step__wiki-cursor setup-step__wiki-cursor--two">
                    <CursorSvg size={14} color="#d8835d" />
                    <em>sol</em>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  void browser.tabs.create({
                    url: "https://en.wikipedia.org/wiki/Wikipedia:Today%27s_featured_article",
                  })
                }
                className="setup-step__text-link"
              >
                Visit Wikipedia ↗
              </button>
            </div>

            <div className="setup-step__actions">
              <button
                onClick={() => setStep("configure")}
                className="setup-step__btn-secondary"
              >
                Back
              </button>
              <button
                onClick={finishOnboarding}
                className="setup-step__btn-primary"
                disabled={busy}
              >
                Finish setup
              </button>
            </div>
          </section>
        )}
      </div>
      {showDevStepNav ? (
        <nav className="setup-page__dev-nav" aria-label="Setup step preview">
          <span>dev</span>
          {SETUP_STEPS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-current={step === id ? "step" : undefined}
              onClick={() => setStep(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
