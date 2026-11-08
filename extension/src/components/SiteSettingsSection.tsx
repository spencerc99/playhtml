// ABOUTME: Settings list of sites with their own privacy setting (turned off, or just for me).
// ABOUTME: Lets people add a site to turn off and turn any listed site back to the default.

import React, { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import {
  SITE_SETTINGS_KEY,
  loadSiteSettings,
  normalizeSiteHost,
  parseSiteSettings,
  setSiteLevel,
  type SiteSettings,
} from "../storage/siteSettings";
import "./SiteSettingsSection.scss";

function formatSince(since: number): string {
  if (!since) return "";
  return new Date(since).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function SiteSettingsSection() {
  const [settings, setSettings] = useState<SiteSettings>({});
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void loadSiteSettings().then(setSettings);
    const listener = (
      changes: Record<string, browser.Storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[SITE_SETTINGS_KEY]) {
        setSettings(parseSiteSettings(changes[SITE_SETTINGS_KEY].newValue));
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  const preview = normalizeSiteHost(draft);
  const sites = Object.entries(settings).sort(
    ([, a], [, b]) => b.since - a.since,
  );

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    await setSiteLevel(preview, "off");
    setSettings(await loadSiteSettings());
    setDraft("");
  };

  const reset = async (host: string) => {
    await setSiteLevel(host, "everyone");
    setSettings(await loadSiteSettings());
  };

  return (
    <div className="site-settings">
      <h2>Sites you turned off</h2>
      <p>
        we were online collects nothing on these sites. You can also turn a site
        off from the popup while you are on it.
      </p>
      <form className="site-settings__add" onSubmit={add}>
        <label htmlFor="site-settings-add" className="site-settings__add-label">
          Site to turn off
        </label>
        <input
          id="site-settings-add"
          type="text"
          placeholder="paste a link or type a site, like bank.com"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!preview}>
          Turn off
        </button>
      </form>
      {preview && draft.trim().toLowerCase() !== preview && (
        <span className="site-settings__preview">
          Will turn off <b>{preview}</b> and all its pages
        </span>
      )}
      {sites.length === 0 ? (
        <p className="site-settings__empty">
          No sites turned off. we were online is on everywhere you browse.
        </p>
      ) : (
        <ul className="site-settings__list">
          {sites.map(([host, setting]) => {
            const date = formatSince(setting.since);
            return (
              <SiteRow
                key={host}
                host={host}
                off={setting.level === "off"}
                date={date}
                onReset={() => void reset(host)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

type DeleteState =
  | { step: "idle" }
  | { step: "confirming" }
  | { step: "deleting" }
  | { step: "done" }
  | { step: "failed"; message: string };

function SiteRow({
  host,
  off,
  date,
  onReset,
}: {
  host: string;
  off: boolean;
  date: string;
  onReset: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, setState] = useState<DeleteState>({ step: "idle" });
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !menuRef.current?.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const remove = async () => {
    setState({ step: "deleting" });
    try {
      const response = (await browser.runtime.sendMessage({
        type: "DELETE_SITE_DATA",
        host,
      })) as { success: boolean; error?: string };
      if (!response?.success) {
        setState({
          step: "failed",
          message: "Couldn't delete it. Nothing was removed, try again.",
        });
        return;
      }
      setState({ step: "done" });
    } catch {
      setState({
        step: "failed",
        message: "Couldn't delete it. Nothing was removed, try again.",
      });
    }
  };

  return (
    <li className="site-settings__item">
      <div className="site-settings__site">
        <span className="site-settings__site-text">
          <span className="site-settings__host">{host}</span>
          <span className="site-settings__since">
            {off ? "Off" : "Just me"}
            {date ? ` since ${date}` : ""}
          </span>
        </span>
        <span className="site-settings__actions">
          <button type="button" onClick={onReset}>
            {off ? "Turn back on" : "Use default"}
          </button>
          <span className="site-settings__menu" ref={menuRef}>
            <button
              type="button"
              className="site-settings__more"
              aria-label={`More for ${host}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ⋯
            </button>
            {menuOpen && (
              <span className="site-settings__menu-list" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="site-settings__menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setState({ step: "confirming" });
                  }}
                >
                  Delete data from this site…
                </button>
              </span>
            )}
          </span>
        </span>
      </div>
      {(state.step === "confirming" || state.step === "deleting") && (
        <div className="site-settings__confirm" role="alertdialog">
          <span>
            {off
              ? `Delete everything collected on ${host} before you turned it off? This can't be undone.`
              : `Delete everything collected on ${host}? This can't be undone.`}
          </span>
          <span className="site-settings__confirm-actions">
            <button
              type="button"
              disabled={state.step === "deleting"}
              onClick={() => setState({ step: "idle" })}
            >
              Cancel
            </button>
            <button
              type="button"
              className="site-settings__delete"
              disabled={state.step === "deleting"}
              onClick={() => void remove()}
            >
              {state.step === "deleting" ? "Deleting…" : "Delete"}
            </button>
          </span>
        </div>
      )}
      {state.step === "done" && (
        <p className="site-settings__result" role="status">
          {`Deleted everything collected on ${host}.`}
        </p>
      )}
      {state.step === "failed" && (
        <p
          className="site-settings__result site-settings__result--error"
          role="status"
        >
          {state.message}
        </p>
      )}
    </li>
  );
}
