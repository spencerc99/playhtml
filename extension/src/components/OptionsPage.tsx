// ABOUTME: Full-page extension settings for identity, collection, updates, and experiments.
// ABOUTME: Organizes settings into searchable sections with a sticky navigation rail.

import React, { FormEvent, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import type { PlayerIdentity } from "../types";
import { CursorSvg } from "./icons";
import {
  DataCollectionSection,
  DeveloperModeSection,
  YourDataSection,
} from "./Collections";
import { DeveloperFeaturesSection } from "./DeveloperFeaturesPage";
import { savePlayerColor } from "../storage/playerColor";
import {
  getPublicPlayerIdentity,
  PLAYER_IDENTITY_STORAGE_KEY,
} from "../storage/playerIdentity";
import { hslToHex } from "../utils/color";
import { isSafariExtensionPageUrl } from "../utils/extensionPage";
import { NEWTAB_TAKEOVER_KEY } from "../features/newtab/takeover";
import { useExperimentAccess } from "../features/useFeatureAccess";
import "./OptionsPage.scss";

const DISCORD_INVITE_URL = "https://discord.gg/SKbsSf4ptU";

const SECTIONS = [
  { id: "identity", title: "Identity" },
  { id: "data-collection", title: "Data collection" },
  { id: "new-tab", title: "New tab" },
  { id: "project-updates", title: "Project updates" },
  { id: "experiments", title: "Experiments" },
  { id: "community", title: "Community" },
  { id: "your-data", title: "Your data" },
  { id: "developer", title: "Developer" },
] as const;

function randomPrimaryColor(): string {
  return hslToHex(Math.floor(Math.random() * 360), 70, 60);
}

function truncatedPublicKey(publicKey: string): string {
  if (publicKey.length <= 12) return publicKey;
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`;
}

export function OptionsPage() {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState("identity");
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [color, setColor] = useState("#4a9a8a");
  const [savingColor, setSavingColor] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newTabTakeover, setNewTabTakeover] = useState(true);
  const [setupEmail, setSetupEmail] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const [accessRequestStatus, setAccessRequestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const colorInputRef = useRef<HTMLInputElement>(null);
  const experimentAccess = useExperimentAccess();
  const isSafari = isSafariExtensionPageUrl(window.location.href);
  const opensNativePickerInPage = !import.meta.env.FIREFOX;

  const visibleSections = SECTIONS.filter(({ title }) =>
    title.toLowerCase().includes(search.trim().toLowerCase()),
  );

  useEffect(() => {
    Promise.all([
      getPublicPlayerIdentity(),
      browser.storage.local.get([NEWTAB_TAKEOVER_KEY, "setup_email"]),
    ])
      .then(([playerIdentity, stored]) => {
        setIdentity(playerIdentity);
        const savedColor = playerIdentity?.playerStyle.colorPalette[0];
        if (savedColor) setColor(savedColor);
        setNewTabTakeover(stored[NEWTAB_TAKEOVER_KEY] !== false);
        const savedEmail = stored.setup_email;
        if (typeof savedEmail === "string" && savedEmail.length > 0) {
          setSetupEmail(savedEmail);
          setEmailDraft(savedEmail);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[PLAYER_IDENTITY_STORAGE_KEY]) return;
      getPublicPlayerIdentity()
        .then((playerIdentity) => {
          setIdentity(playerIdentity);
          const savedColor = playerIdentity?.playerStyle.colorPalette[0];
          if (savedColor) setColor(savedColor);
        })
        .catch(() => {});
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    document
      .querySelectorAll<HTMLElement>(".options-page__section")
      .forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [search]);

  const handleOpenColorPicker = async () => {
    if (opensNativePickerInPage) {
      colorInputRef.current?.click();
      return;
    }
    await browser.windows.create({
      url: browser.runtime.getURL("color-picker.html"),
      type: "popup",
      width: 360,
      height: 260,
    });
  };

  const handleSaveColor = async () => {
    setSavingColor(true);
    try {
      const updated = await savePlayerColor(color);
      if (updated) setIdentity(updated);
    } finally {
      setSavingColor(false);
    }
  };

  const handleCopyPublicKey = async () => {
    if (!identity) return;
    await navigator.clipboard.writeText(identity.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveEmail = async (event: FormEvent) => {
    event.preventDefault();
    const email = emailDraft.trim();
    if (!email) return;
    setEmailStatus("saving");
    try {
      const response = await fetch(`${WORKER_URL}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "options" }),
      });
      if (!response.ok)
        throw new Error(`Subscription failed with ${response.status}`);
      await browser.storage.local.set({ setup_email: email });
      setSetupEmail(email);
      setEmailDraft(email);
      setEditingEmail(false);
      setEmailStatus("idle");
    } catch {
      setEmailStatus("error");
    }
  };

  const requestExperimentAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!identity) return;
    setAccessRequestStatus("sending");
    try {
      const response = await fetch(`${WORKER_URL}/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicId: identity.publicKey,
          email: emailDraft.trim() || undefined,
          requestedFeatures: ["COMMUTE", "SCRAPS"],
        }),
      });
      if (!response.ok)
        throw new Error(`Access request failed with ${response.status}`);
      setAccessRequestStatus("sent");
    } catch {
      setAccessRequestStatus("error");
    }
  };

  const sectionIsVisible = (id: (typeof SECTIONS)[number]["id"]) =>
    visibleSections.some((section) => section.id === id);

  return (
    <div className="options-page">
      <aside className="options-page__rail">
        <div className="options-page__brand">
          <strong>we were online</strong>
          <span>settings</span>
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
          className="options-page__search"
        />
        <nav aria-label="Settings sections">
          {SECTIONS.map(({ id, title }) => (
            <a
              key={id}
              href={`#${id}`}
              className={
                activeSection === id ? "options-page__toc-link--active" : ""
              }
            >
              {title.toLowerCase()}
            </a>
          ))}
        </nav>
      </aside>

      <main className="options-page__content">
        {sectionIsVisible("identity") && (
          <section id="identity" className="options-page__section">
            <h1>Identity</h1>
            <div className="options-page__card">
              <div className="options-page__setting-row">
                <div>
                  <h2>Cursor color</h2>
                  <p>The color other people see when your cursor appears.</p>
                </div>
                <div className="options-page__identity-actions">
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="options-page__color-input"
                  />
                  <button
                    type="button"
                    onClick={() => void handleOpenColorPicker()}
                    aria-label="Pick cursor color"
                  >
                    <CursorSvg size={36} color={color} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setColor(randomPrimaryColor())}
                    aria-label="Re-roll color"
                  >
                    ↻
                  </button>
                  {color !== identity?.playerStyle.colorPalette[0] && (
                    <button
                      type="button"
                      onClick={() => void handleSaveColor()}
                      disabled={savingColor}
                    >
                      {savingColor ? "Saving..." : "Save"}
                    </button>
                  )}
                </div>
              </div>
              <div className="options-page__setting-row">
                <div>
                  <h2>Anonymous ID</h2>
                  <p>
                    A key generated in this browser. It's how your trails are
                    recognized as yours — it says nothing about who you are.
                  </p>
                </div>
                {identity && (
                  <div className="options-page__key-actions">
                    <code>{truncatedPublicKey(identity.publicKey)}</code>
                    <button
                      type="button"
                      onClick={() => void handleCopyPublicKey()}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {sectionIsVisible("data-collection") && (
          <section id="data-collection" className="options-page__section">
            <h1>Data collection</h1>
            <div className="options-page__card options-page__collections-card">
              <DataCollectionSection />
            </div>
          </section>
        )}

        {sectionIsVisible("new-tab") && (
          <section id="new-tab" className="options-page__section">
            <h1>New tab</h1>
            <div className="options-page__card">
              <h2>New tab</h2>
              <p>Open your history page in every new tab.</p>
              {isSafari ? (
                <p className="options-page__mono-note">
                  Safari doesn't let extensions change the new tab — bookmark or
                  pin the history page to keep it a click away.
                </p>
              ) : (
                <label className="options-page__checkbox">
                  <input
                    type="checkbox"
                    checked={newTabTakeover}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setNewTabTakeover(enabled);
                      void browser.storage.local.set({
                        [NEWTAB_TAKEOVER_KEY]: enabled,
                      });
                    }}
                  />
                  make this my new tab
                </label>
              )}
            </div>
          </section>
        )}

        {sectionIsVisible("project-updates") && (
          <section id="project-updates" className="options-page__section">
            <h1>Project updates</h1>
            <div className="options-page__card">
              {setupEmail && !editingEmail ? (
                <div className="options-page__email-current">
                  <code>{setupEmail}</code>
                  <button type="button" onClick={() => setEditingEmail(true)}>
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void browser.storage.local.remove("setup_email");
                      setSetupEmail(null);
                      setEmailDraft("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <form className="options-page__email-form" onSubmit={saveEmail}>
                  <input
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <button type="submit" disabled={emailStatus === "saving"}>
                    {emailStatus === "saving"
                      ? "Saving..."
                      : setupEmail
                        ? "Save"
                        : "Subscribe"}
                  </button>
                </form>
              )}
              <p>
                Only used for occasional project updates. Never connected to
                your browsing data, which stays anonymous.
              </p>
              {emailStatus === "error" && (
                <small role="alert">
                  Couldn’t save your email. Please try again.
                </small>
              )}
            </div>
          </section>
        )}

        {sectionIsVisible("experiments") && (
          <section id="experiments" className="options-page__section">
            <h1>Experiments</h1>
            <div className="options-page__card">
              {experimentAccess && <DeveloperFeaturesSection />}
              <div className="options-page__access-request">
                <h2>Request early access</h2>
                <p>
                  Request early access to new experimental features to make the
                  internet feel more shared and alive. Experiments stay off
                  until you choose to enable them.
                </p>
                {accessRequestStatus === "sent" ? (
                  <strong>Request sent</strong>
                ) : (
                  <form onSubmit={requestExperimentAccess}>
                    <input
                      type="email"
                      value={emailDraft}
                      onChange={(event) => setEmailDraft(event.target.value)}
                      placeholder="Email for a reply (optional)"
                    />
                    <button
                      type="submit"
                      disabled={!identity || accessRequestStatus === "sending"}
                    >
                      {accessRequestStatus === "sending"
                        ? "Sending…"
                        : "Request access"}
                    </button>
                  </form>
                )}
                {accessRequestStatus === "error" && (
                  <small role="alert">
                    Couldn’t send the request. Please try again.
                  </small>
                )}
              </div>
            </div>
          </section>
        )}

        {sectionIsVisible("community") && (
          <section
            id="community"
            className="options-page__section options-page__community"
          >
            <h1>Community</h1>
            <div>
              <h2>Help shape WWO</h2>
              <p>
                Join the community to share what you're seeing and get a look at
                experiments before they ship.
              </p>
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
                Join the Discord ↗
              </a>
            </div>
          </section>
        )}

        {sectionIsVisible("your-data") && (
          <section id="your-data" className="options-page__section">
            <h1>Your data</h1>
            <div className="options-page__card options-page__collections-card">
              <YourDataSection />
            </div>
          </section>
        )}

        {sectionIsVisible("developer") && (
          <section id="developer" className="options-page__section">
            <h1>Developer</h1>
            <div className="options-page__card options-page__collections-card">
              <DeveloperModeSection />
            </div>
          </section>
        )}

        {visibleSections.length === 0 && (
          <p className="options-page__no-results">
            No settings sections match “{search}”.
          </p>
        )}
      </main>
    </div>
  );
}
