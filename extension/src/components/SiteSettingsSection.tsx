// ABOUTME: Settings list of sites with their own privacy setting (turned off, or just for me).
// ABOUTME: Lets people add a site to turn off and turn any listed site back to the default.

import React, { useEffect, useState } from "react";
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
  const sites = Object.entries(settings)
    .filter(([, setting]) => setting.level !== "everyone")
    .sort(([, a], [, b]) => b.since - a.since);

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
            const off = setting.level === "off";
            return (
              <li key={host} className="site-settings__site">
                <span className="site-settings__site-text">
                  <span className="site-settings__host">{host}</span>
                  <span className="site-settings__since">
                    {off ? "Off" : "Just me"}
                    {date ? ` since ${date}` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => void reset(host)}>
                  {off ? "Turn back on" : "Use default"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
