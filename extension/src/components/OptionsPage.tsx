// ABOUTME: Full-page extension settings for identity, collection, community, and experiments.
// ABOUTME: Organizes settings into sections with a sticky navigation rail.

import React, { FormEvent, useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { WORKER_URL } from "@movement/config";
import type { GameInventory, PlayerIdentity, PlayHTMLStatus } from "../types";
import { CursorSvg } from "./icons";
import {
  DataCollectionSection,
  DeveloperModeSection,
  YourDataSection,
} from "./Collections";
import { DeveloperFeaturesSection } from "./DeveloperFeaturesPage";
import { FeatureGate } from "./FeatureGate";
import { Inventory } from "./Inventory";
import { QuickActions } from "./QuickActions";
import { SiteStatus } from "./SiteStatus";
import { savePlayerColor } from "../storage/playerColor";
import {
  getPublicPlayerIdentity,
  PLAYER_IDENTITY_STORAGE_KEY,
} from "../storage/playerIdentity";
import { hslToHex } from "../utils/color";
import { isSafariExtensionPageUrl } from "../utils/extensionPage";
import { NEWTAB_TAKEOVER_KEY } from "../features/newtab/takeover";
import {
  useExperimentAccess,
  useFeatureState,
} from "../features/useFeatureAccess";
import "./OptionsPage.scss";

const DISCORD_INVITE_URL = "https://discord.gg/SKbsSf4ptU";

const SECTIONS = [
  { id: "identity", title: "Identity" },
  { id: "data-collection", title: "Data collection" },
  { id: "browser", title: "Browser" },
  { id: "bag-settings", title: "Bag settings" },
  { id: "experiments", title: "Experiments" },
  { id: "community", title: "Community" },
  { id: "your-data", title: "Your data" },
] as const;

function randomPrimaryColor(): string {
  return hslToHex(Math.floor(Math.random() * 360), 70, 60);
}

function truncatedPublicKey(publicKey: string): string {
  if (publicKey.length <= 12) return publicKey;
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`;
}

function BagSettingsSection() {
  const [currentTab, setCurrentTab] = useState<browser.Tabs.Tab | null>(null);
  const [playhtmlStatus, setPlayhtmlStatus] = useState<PlayHTMLStatus>({
    detected: false,
    elementCount: 0,
    checking: true,
  });
  const [inventory, setInventory] = useState<GameInventory>({
    items: [],
    totalItems: 0,
    lastUpdated: 0,
  });
  const [showInventory, setShowInventory] = useState(false);

  useEffect(() => {
    Promise.all([
      browser.tabs.query({ active: true, currentWindow: true }),
      browser.storage.local.get(["gameInventory"]),
    ])
      .then(([tabs, stored]) => {
        const tab = tabs[0] ?? null;
        setCurrentTab(tab);
        if (stored.gameInventory) setInventory(stored.gameInventory);
        if (!tab?.id) {
          setPlayhtmlStatus({
            detected: false,
            elementCount: 0,
            checking: false,
          });
          return;
        }
        return browser.tabs
          .sendMessage(tab.id, { type: "CHECK_PLAYHTML_STATUS" })
          .then((status) => setPlayhtmlStatus({ ...status, checking: false }))
          .catch(() =>
            setPlayhtmlStatus({
              detected: false,
              elementCount: 0,
              checking: false,
            }),
          );
      })
      .catch(() => {
        setPlayhtmlStatus({
          detected: false,
          elementCount: 0,
          checking: false,
        });
      });
  }, []);

  const sendToCurrentTab = async (message: { type: string }) => {
    if (currentTab?.id) await browser.tabs.sendMessage(currentTab.id, message);
  };

  const clearInventory = async () => {
    if (
      !confirm(
        "Are you sure you want to clear your entire inventory? This cannot be undone.",
      )
    )
      return;
    const emptyInventory: GameInventory = {
      items: [],
      totalItems: 0,
      lastUpdated: Date.now(),
    };
    setInventory(emptyInventory);
    await browser.storage.local.set({ gameInventory: emptyInventory });
  };

  if (showInventory) {
    return (
      <Inventory
        inventory={inventory}
        onBack={() => setShowInventory(false)}
        onRemoveItem={async (itemId) => {
          const updatedInventory = {
            ...inventory,
            items: inventory.items.filter((item) => item.id !== itemId),
            totalItems: Math.max(0, inventory.totalItems - 1),
            lastUpdated: Date.now(),
          };
          setInventory(updatedInventory);
          await browser.storage.local.set({ gameInventory: updatedInventory });
        }}
        onClearInventory={() => void clearInventory()}
      />
    );
  }

  return (
    <>
      <SiteStatus currentTab={currentTab} playhtmlStatus={playhtmlStatus} />
      <QuickActions
        onTestConnection={() => void sendToCurrentTab({ type: "PING" })}
        onPickElement={() =>
          void sendToCurrentTab({ type: "ACTIVATE_ELEMENT_PICKER" })
        }
        onViewInventory={() => setShowInventory(true)}
        onViewCollections={() => (window.location.hash = "#data-collection")}
        onViewHistory={() =>
          void sendToCurrentTab({ type: "TOGGLE_HISTORICAL_OVERLAY" })
        }
        inventory={inventory}
        showBagFeatures
      />
    </>
  );
}

export function OptionsPage() {
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
  const bagSettingsEnabled = useFeatureState("BAG_SETTINGS").enabled;
  const isSafari = isSafariExtensionPageUrl(window.location.href);
  const opensNativePickerInPage = !import.meta.env.FIREFOX;

  const sections = bagSettingsEnabled
    ? SECTIONS
    : SECTIONS.filter(({ id }) => id !== "bag-settings");

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
  }, [bagSettingsEnabled]);

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
        body: JSON.stringify({ email, source: "extension-setup" }),
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

  return (
    <div className="options-page">
      <aside className="options-page__rail">
        <div className="options-page__brand">
          <strong>we were online</strong>
          <span>settings</span>
        </div>
        <nav aria-label="Settings sections">
          {sections.map(({ id, title }) => (
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

        <section id="data-collection" className="options-page__section">
          <h1>Data collection</h1>
          <div className="options-page__card options-page__collections-card">
            <DataCollectionSection />
          </div>
        </section>

        <section id="browser" className="options-page__section">
          <h1>Browser</h1>
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

        {bagSettingsEnabled && (
          <FeatureGate feature="BAG_SETTINGS">
            <section id="bag-settings" className="options-page__section">
              <h1>Bag settings</h1>
              <div className="options-page__card">
                <BagSettingsSection />
              </div>
            </section>
          </FeatureGate>
        )}

        <section id="experiments" className="options-page__section">
          <h1>Experiments</h1>
          <div className="options-page__card">
            {experimentAccess && <DeveloperFeaturesSection />}
            <div
              className={`options-page__access-request${
                experimentAccess ? " options-page__access-request--divided" : ""
              }`}
            >
              <h2>Request early access</h2>
              <p>
                Request early access to new experimental features to make the
                internet feel more shared and alive. Experiments stay off until
                you choose to enable them. Leaving an email also signs you up
                for occasional project updates.
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
                    className="options-page__request-button"
                    disabled={!identity || accessRequestStatus === "sending"}
                  >
                    {accessRequestStatus === "sending"
                      ? "Sending…"
                      : "Request early access"}
                  </button>
                </form>
              )}
              {accessRequestStatus === "error" && (
                <small role="alert">
                  Couldn’t send the request. Please try again.
                </small>
              )}
            </div>
            <div className="options-page__developer-mode options-page__developer-mode--divided">
              <DeveloperModeSection />
            </div>
          </div>
        </section>

        <section id="community" className="options-page__section">
          <h1>Community</h1>
          <div className="options-page__card">
            <div className="options-page__discord-band">
              <h2>Help shape WWO</h2>
              <p>
                Join the community to share what you're seeing and get a look at
                experiments before they ship.
              </p>
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
                Join the Discord ↗
              </a>
            </div>
            <div className="options-page__community-email">
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
                    Forget on this device
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
              <p>To unsubscribe, use the link in any project email.</p>
              {emailStatus === "error" && (
                <small role="alert">
                  Couldn’t save your email. Please try again.
                </small>
              )}
            </div>
          </div>
        </section>

        <section id="your-data" className="options-page__section">
          <h1>Your data</h1>
          <div className="options-page__card options-page__collections-card">
            <YourDataSection />
          </div>
        </section>
      </main>
    </div>
  );
}
