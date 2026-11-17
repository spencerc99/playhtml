// ABOUTME: Playground for per-site privacy: the popup's site switch and the Settings list, using the real components.
// ABOUTME: Stands in for the extension's storage events and delete message so the flow can be tried in a browser.

import { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import {
  SitePrivacyControl,
  useSiteLevel,
} from "@extension/components/SitePrivacyControl";
import { SiteSettingsSection } from "@extension/components/SiteSettingsSection";
import { CollectorIcon } from "@extension/components/icons";
import { SITE_SETTINGS_KEY } from "@extension/storage/siteSettings";
import "@extension/components/InternetPortraitHome.scss";
import "@extension/components/OptionsPage.scss";

type Listener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string,
) => void;

/**
 * The site's webextension shim has no storage events and answers every message
 * with nothing. Here the popup and Settings need to see each other's changes, and
 * "Delete data from this site" needs an answer, so wrap both for this page only.
 */
function installPlaygroundBrowser(): void {
  const shim = browser as unknown as {
    storage: {
      local: { set: (items: Record<string, unknown>) => Promise<void> };
      onChanged: {
        addListener: (l: Listener) => void;
        removeListener: (l: Listener) => void;
      };
    };
    runtime: { sendMessage: (message: unknown) => Promise<unknown> };
    __sitePrivacyPlayground?: boolean;
  };
  if (shim.__sitePrivacyPlayground) return;
  shim.__sitePrivacyPlayground = true;

  const listeners = new Set<Listener>();
  const set = shim.storage.local.set.bind(shim.storage.local);
  shim.storage.local.set = async (items) => {
    await set(items);
    const changes = Object.fromEntries(
      Object.entries(items).map(([key, newValue]) => [key, { newValue }]),
    );
    for (const listener of listeners) listener(changes, "local");
  };
  shim.storage.onChanged = {
    addListener: (l) => listeners.add(l),
    removeListener: (l) => listeners.delete(l),
  };
  shim.runtime.sendMessage = async (message) => {
    const type = (message as { type?: string })?.type;
    if (type === "DELETE_SITE_DATA") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return { success: true };
    }
    return undefined;
  };
}

installPlaygroundBrowser();

const SITES = ["linkedin.com", "chase.com", "news.ycombinator.com"];

const COLLECTORS: { type: string; mode: "shared" | "local" | "off" }[] = [
  { type: "cursor", mode: "shared" },
  { type: "navigation", mode: "shared" },
  { type: "viewport", mode: "local" },
  { type: "keyboard", mode: "off" },
];

function PopupStatusCard({ host }: { host: string }) {
  const site = useSiteLevel(host);
  const level = site.level ?? "everyone";
  const off = level === "off";
  return (
    <section
      className={`collection-status${off ? " collection-status--site-off" : ""}`}
      style={{ marginBottom: 0 }}
    >
      <SitePrivacyControl host={host} level={level} onChoose={site.choose} />
      <div className="collection-status__grid">
        {COLLECTORS.map(({ type, mode }) => {
          const shown =
            level === "just-me" && mode === "shared" ? "local" : mode;
          return (
            <div key={type} className="collector-pill">
              <div className="collector-pill__name-row">
                <span aria-hidden className="collector-pill__icon">
                  <CollectorIcon type={type} />
                </span>
                <span className="collector-pill__name">{type}</span>
              </div>
              <span
                className={`collector-pill__state collector-pill__state--${shown}`}
              >
                {shown}
              </span>
            </div>
          );
        })}
      </div>
      <div className="collection-status__footer-row">
        <span>Your settings for every site</span>
        <a
          href="#section-site-privacy-settings"
          className="collection-status__settings-link"
          onClick={(event) => {
            event.preventDefault();
            document
              .getElementById("section-site-privacy-settings")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          Settings →
        </a>
      </div>
    </section>
  );
}

export function SitePrivacySection() {
  const [host, setHost] = useState(SITES[0]);
  const [resetKey, setResetKey] = useState(0);

  // Start each visit from a clean slate so everyone sees the same first screen.
  useEffect(() => {
    void browser.storage.local.set({ [SITE_SETTINGS_KEY]: {} });
  }, []);

  return (
    <div className="site-privacy-preview">
      <div id="section-site-privacy-popup" className="popup-variant-row">
        <div className="popup-variant__label">popup, on a site</div>
        <div className="popup-variant__note">
          Pretend you're browsing one of these sites, then open the extension.
          The switch turns collection on or off for that site only. When it's
          on, "Seen by" picks whether what's collected here is shared with
          everyone or kept just for you.
        </div>
        <div
          className="site-privacy-preview__sites"
          role="radiogroup"
          aria-label="Site you're on"
        >
          {SITES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === host}
              className={`site-privacy-preview__site${s === host ? " site-privacy-preview__site--on" : ""}`}
              onClick={() => setHost(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="popup-frame site-privacy-preview__popup">
          <div className="popup-frame__row popup-frame__row--tight">
            <div className="popup-frame__wordmark">we were online</div>
          </div>
          <PopupStatusCard key={`${host}-${resetKey}`} host={host} />
        </div>
      </div>

      <div id="section-site-privacy-settings" className="popup-variant-row">
        <div className="popup-variant__label">settings</div>
        <div className="popup-variant__note">
          Every site you've turned off shows up here, including ones you turn
          off in the popup above. You can also add a site by typing it or
          pasting a link, turn it back on, or delete what was collected there
          from the ⋯ menu. (Nothing is really deleted on this page.)
        </div>
        <div className="site-privacy-preview__settings options-page__card">
          <SiteSettingsSection key={resetKey} />
        </div>
        <button
          type="button"
          className="site-privacy-preview__reset"
          onClick={() => {
            void browser.storage.local
              .set({ [SITE_SETTINGS_KEY]: {} })
              .then(() => setResetKey((k) => k + 1));
          }}
        >
          start over
        </button>
      </div>
    </div>
  );
}
