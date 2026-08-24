// ABOUTME: Full-page setup wizard for first-time extension configuration
// ABOUTME: Handles consent, cursor color, new tab choice, product tour, and update signup
import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { getValidEventTypes } from "@playhtml/extension-types";
import { CursorSvg } from "./icons";
import { CollectorList } from "./Collections";
import {
  collectionModeStorageKey,
  normalizeCollectionMode,
  supportsSharedCollection,
  type CollectionMode,
} from "../collectors/modes";
import { useVisibleCollectorTypes } from "./useVisibleCollectorTypes";
import { TrailsHero } from "./TrailsHero";
import { savePlayerColor } from "../storage/playerColor";
import { getPublicPlayerIdentity } from "../storage/playerIdentity";
import { LEGIBILITY_KEY } from "../utils/keyboardRedaction";
import "./SetupPage.scss";
import { hslToHex } from "../utils/color";
import { MilestoneToastPreview } from "./MilestoneToastPreview";
import { isSafariExtensionPageUrl } from "../utils/extensionPage";
import { WORKER_URL } from "@movement/config";
import {
  hasSafariWebsiteAccess,
  requestSafariWebsiteAccess,
} from "../utils/safariWebsiteAccess";
import { NEWTAB_TAKEOVER_KEY } from "../features/newtab/takeover";

type Step = "welcome" | "configure" | "done";
type Preset = "abstain" | "participate" | "allIn";
type CollectorMode = CollectionMode;
type WebsiteAccess = "checking" | "needed" | "requesting" | "granted" | "error";

const SETUP_STEPS: Array<{ id: Step; label: string }> = [
  { id: "welcome", label: "welcome" },
  { id: "configure", label: "consent" },
  { id: "done", label: "complete" },
];

const DISCORD_INVITE_URL = "https://discord.gg/SKbsSf4ptU";

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

function setupStorageError(isSafari: boolean): string {
  return isSafari
    ? "Safari couldn’t save your choices. Disable and re-enable we were online in Safari Settings → Extensions, then try again."
    : "The extension couldn’t save your choices. Check that it is enabled, then try again.";
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
    for (const t of types)
      r[t] = supportsSharedCollection(t) ? "shared" : "local";
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
  const [email, setEmail] = useState("");
  const visibleTypes = useVisibleCollectorTypes();
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
  // Opt-out: the step presents the takeover as the default and the checkbox
  // is how you decline it.
  const [newTabTakeover, setNewTabTakeover] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });
  const isSafari = isSafariExtensionPageUrl(window.location.href);
  const [websiteAccess, setWebsiteAccess] = useState<WebsiteAccess>(
    isSafari ? "checking" : "granted",
  );

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

  useEffect(() => {
    if (!isSafari) return;

    hasSafariWebsiteAccess()
      .then((granted) => setWebsiteAccess(granted ? "granted" : "needed"))
      .catch(() => setWebsiteAccess("error"));
  }, [isSafari]);

  const handleWebsiteAccess = async () => {
    setWebsiteAccess("requesting");
    try {
      const granted = await requestSafariWebsiteAccess();
      setWebsiteAccess(granted ? "granted" : "needed");
    } catch {
      setWebsiteAccess("error");
    }
  };

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
    setSaveError(null);
    try {
      const toSet: Record<string, unknown> = {};
      for (const t of visibleTypes)
        toSet[collectionModeStorageKey(t)] = normalizeCollectionMode(
          t,
          collectorModes[t],
        );
      toSet[LEGIBILITY_KEY] = legibilityPct;

      await browser.storage.local.set(toSet);
      await savePlayerColor(color);
      setStep("done");
    } catch {
      setSaveError(setupStorageError(isSafari));
    } finally {
      setBusy(false);
    }
  };

  const closeSetupTab = async () => {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id === undefined) {
      throw new Error("Could not find the setup tab");
    }
    await browser.tabs.remove(tab.id);
  };

  const finishOnboarding = async () => {
    setBusy(true);
    setSaveError(null);
    const trimmedEmail = email.trim();

    try {
      if (trimmedEmail) {
        try {
          const response = await fetch(`${WORKER_URL}/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: trimmedEmail,
              source: "extension-setup",
            }),
          });

          if (!response.ok) {
            throw new Error(
              `Subscription failed with status ${response.status}`,
            );
          }
        } catch {
          setSaveError(
            "We couldn’t sign you up for updates. Try again, or clear the field to finish without signing up.",
          );
          return;
        }
      }

      await browser.storage.local.set({
        onboarding_complete: "true",
        [NEWTAB_TAKEOVER_KEY]: isSafari ? false : newTabTakeover,
        ...(trimmedEmail ? { setup_email: trimmedEmail } : {}),
      });
      await closeSetupTab();
    } catch {
      setSaveError(setupStorageError(isSafari));
    } finally {
      setBusy(false);
    }
  };

  const presetOrder: Preset[] = ["abstain", "participate", "allIn"];

  return (
    <div className="setup-page">
      <div className="setup-step__trail-art" ref={heroRef} aria-hidden>
        <TrailsHero width={heroSize.width} height={heroSize.height} />
      </div>
      <div
        className={
          "setup-page__inner" +
          (step === "done" ? " setup-page__inner--complete" : "")
        }
      >
        {step === "welcome" && (
          <form
            className="setup-step"
            onSubmit={(event) => {
              event.preventDefault();
              setStep("configure");
            }}
          >
            <h1 className="setup-step__title">we were online</h1>
            <p className="setup-step__desc">
              we were online turns the existing Internet into a living, shared
              world. Let's get you set up in a few steps so we can respect your
              preferences for privacy and share how the extension works.
            </p>
            <div className="setup-step__discord-card">
              <span className="setup-step__discord-copy">
                <strong>Help shape WWO</strong>
                <span>
                  Join the community to share what you're seeing and get a look
                  at experiments before they ship.
                </span>
              </span>
              <a
                href={DISCORD_INVITE_URL}
                target="_blank"
                rel="noreferrer"
                className="setup-step__discord-button"
              >
                Join the Discord ↗
              </a>
            </div>
            {isSafari && websiteAccess !== "granted" && (
              <div className="setup-step__website-access">
                <h2 className="setup-step__subheading">
                  Let it work across Safari
                </h2>
                <p className="setup-step__desc">
                  Safari keeps the extension off on each new website until you
                  allow access. This access lets it collect only the trail you
                  choose to keep on the next screen.
                </p>
                <button
                  type="button"
                  onClick={handleWebsiteAccess}
                  className="setup-step__btn-primary"
                  disabled={
                    websiteAccess === "checking" ||
                    websiteAccess === "requesting"
                  }
                >
                  {websiteAccess === "requesting"
                    ? "Waiting for Safari…"
                    : "Allow on every website"}
                </button>
                <p className="setup-step__website-access-hint">
                  When Safari asks, choose “Always Allow on Every Website.”
                </p>
                {websiteAccess === "error" && (
                  <p className="setup-step__website-access-error">
                    Safari didn’t change access. Try again, or open Safari
                    Settings → Websites → Extensions.
                  </p>
                )}
              </div>
            )}
            {isSafari && websiteAccess === "granted" && (
              <p className="setup-step__website-access-success">
                Safari website access is on.
              </p>
            )}
            <div className="setup-step__field">
              <label
                className="setup-step__field-label"
                htmlFor="updates-email"
              >
                Email for project updates (optional)
              </label>
              <input
                id="updates-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                aria-describedby="updates-email-help"
                className="setup-step__input"
              />
              <span id="updates-email-help" className="setup-step__field-help">
                Get occasional updates about we were online and opportunities
                to help shape new features
              </span>
            </div>
            <div className="setup-step__welcome-actions">
              <button type="submit" className="setup-step__btn-primary">
                Get started
              </button>
              <span>takes about a minute</span>
            </div>
          </form>
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
                {saveError ? "Try again" : "Continue"}
              </button>
            </div>
            {saveError && (
              <p className="setup-step__save-error" role="alert">
                {saveError}
              </p>
            )}
          </section>
        )}

        {step === "done" && (
          <section className="setup-step setup-step--complete">
            <h2 className="setup-step__heading">All set!</h2>
            <p className="setup-step__desc">
              You can close this tab and open the popup to explore your
              portrait. A few things to know as you wander:
            </p>

            <div className="setup-step__tips-grid">
              <div className="setup-step__tip">
                <h3 className="setup-step__subheading">Review your browsing</h3>
                <div className="setup-step__newtab-preview">
                  <div className="setup-step__newtab-chrome">
                    <span className="setup-step__newtab-dot setup-step__newtab-dot--close" />
                    <span className="setup-step__newtab-dot setup-step__newtab-dot--min" />
                    <span className="setup-step__newtab-dot setup-step__newtab-dot--expand" />
                  </div>
                  <img
                    src={browser.runtime.getURL(
                      "setup/walking-record-preview.png",
                    )}
                    alt="Your history page: a week of browsing time, the sites you spent it on, and a portrait from each day."
                    className="setup-step__newtab-shot"
                  />
                </div>
                <p className="setup-step__desc">
                  Your history page reviews where your time went, the smaller
                  places you explored, and a cursor portrait from each day.
                </p>
                {isSafari ? (
                  <p className="setup-step__newtab-note">
                    Safari doesn't let extensions change the new tab — bookmark
                    or pin the history page to keep it a click away.
                  </p>
                ) : (
                  <label className="setup-step__newtab-optin">
                    <input
                      type="checkbox"
                      checked={newTabTakeover}
                      onChange={(event) =>
                        setNewTabTakeover(event.target.checked)
                      }
                    />
                    <span>make this my new tab</span>
                  </label>
                )}
              </div>

              <div className="setup-step__tip setup-step__tip--trail">
                <h3 className="setup-step__subheading">
                  See your trail, anywhere
                </h3>
                <div className="setup-step__trail-preview" aria-hidden="true">
                  <div className="setup-step__trail-lines">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <svg viewBox="0 0 420 140" fill="none" aria-hidden="true">
                    <path
                      d="M38 111 C84 94 78 43 132 50 S188 118 236 87 S286 28 340 47"
                      stroke="#4a9a8a"
                      strokeOpacity="0.5"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M22 68 C70 18 118 106 167 78 S228 31 275 71 S328 119 394 83"
                      stroke="#c4724e"
                      strokeOpacity="0.4"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 4 3 L 14 9 L 9.5 10.5 L 8 15 Z"
                      fill="#4a9a8a"
                      transform="translate(336 41)"
                    />
                  </svg>
                </div>
                <p className="setup-step__desc">
                  Press{" "}
                  <kbd className="setup-step__kbd">
                    {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
                  </kbd>
                  <span className="setup-step__kbd-plus">+</span>
                  <kbd className="setup-step__kbd">Shift</kbd>
                  <span className="setup-step__kbd-plus">+</span>
                  <kbd className="setup-step__kbd">H</kbd> on any page to bring
                  up your historical overlay—the cursor trails, clicks, and
                  scrolls you left there before.
                </p>
              </div>

              <div className="setup-step__tip">
                <h3 className="setup-step__subheading">
                  See your progress
                </h3>
                <MilestoneToastPreview />
                <p className="setup-step__desc">
                  We'll share some of your progress as you browse.
                </p>
                <p className="setup-step__progress-note">
                  Click{" "}
                  <span className="setup-step__toolbar-icon">
                    <img
                      src={browser.runtime.getURL("icon/32.png")}
                      alt="we were online extension icon"
                    />
                  </span>{" "}
                  in your browser toolbar anytime to see your current portrait.
                  Pin it to keep it one click away.
                </p>
              </div>

              <div className="setup-step__tip">
                <h3 className="setup-step__subheading">
                  Wikipedia feels inhabited
                </h3>
                <p className="setup-step__desc">
                  On Wikipedia, live cursors, article chat, remembered links,
                  and shared trails turn reading into a place where you can
                  cross paths with other visitors.
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
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void finishOnboarding();
              }}
            >
              <div className="setup-step__actions">
                <button
                  type="button"
                  onClick={() => setStep("configure")}
                  className="setup-step__btn-secondary"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="setup-step__btn-primary"
                  disabled={busy}
                >
                  {saveError ? "Try again" : "Finish setup"}
                </button>
              </div>
              {saveError && (
                <p className="setup-step__save-error" role="alert">
                  {saveError}
                </p>
              )}
            </form>
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
