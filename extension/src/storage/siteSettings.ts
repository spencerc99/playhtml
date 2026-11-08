// ABOUTME: Per-site privacy choices: turn collection off on a site, or keep it just for you.
// ABOUTME: Owns the storage shape, host normalization, and lookup that the content script, popup, and uploads share.

import browser from "webextension-polyfill";

export const SITE_SETTINGS_KEY = "site_settings";

/**
 * "everyone" follows your usual collector settings and is the default, so it is
 * never stored. "just-me" collects as usual but never uploads. "off" collects
 * nothing on the site.
 */
export type SiteLevel = "everyone" | "just-me" | "off";

export interface SiteSetting {
  level: Exclude<SiteLevel, "everyone">;
  /** When the person picked this level, in ms since epoch. */
  since: number;
}

export type SiteSettings = Record<string, SiteSetting>;

/**
 * Turns a link, host, or typed site name into the host we store, like
 * "chase.com". Drops scheme, path, port, and a leading "www.". Returns "" when
 * the input isn't a usable host.
 */
export function normalizeSiteHost(input: string): string {
  let host = (input ?? "").trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0] ?? "";
  host = host.replace(/^[^@]*@/, "");
  host = host.split(":")[0] ?? "";
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return "";
  return host;
}

export function parseSiteSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SiteSettings = {};
  for (const [host, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const { level, since } = raw as Partial<SiteSetting>;
    if (level !== "off" && level !== "just-me") continue;
    out[host] = {
      level,
      since: typeof since === "number" && Number.isFinite(since) ? since : 0,
    };
  }
  return out;
}

/**
 * The stored entry that applies to a host, if any. An entry covers the host and
 * all its subdomains; the most specific entry wins, so "chase.com" off with
 * "news.chase.com" just me leaves news.chase.com collecting just for you.
 */
export function findSiteSetting(
  settings: SiteSettings,
  hostOrUrl: string,
): { host: string; setting: SiteSetting } | null {
  const host = normalizeSiteHost(hostOrUrl);
  if (!host) return null;
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const setting = settings[candidate];
    if (setting) return { host: candidate, setting };
  }
  return null;
}

export function siteLevelFor(
  settings: SiteSettings,
  hostOrUrl: string,
): SiteLevel {
  return findSiteSetting(settings, hostOrUrl)?.setting.level ?? "everyone";
}

export async function loadSiteSettings(): Promise<SiteSettings> {
  try {
    const result = await browser.storage.local.get(SITE_SETTINGS_KEY);
    return parseSiteSettings(result[SITE_SETTINGS_KEY]);
  } catch {
    return {};
  }
}

export async function getSiteLevel(hostOrUrl: string): Promise<SiteLevel> {
  return siteLevelFor(await loadSiteSettings(), hostOrUrl);
}

/**
 * Stores a level for a host. "everyone" clears the host's entry. Returns the
 * host as stored, or "" when the input isn't a usable host.
 */
export async function setSiteLevel(
  hostOrUrl: string,
  level: SiteLevel,
  now: number = Date.now(),
): Promise<string> {
  const host = normalizeSiteHost(hostOrUrl);
  if (!host) return "";
  const settings = await loadSiteSettings();
  if (level === "everyone") {
    delete settings[host];
  } else if (settings[host]?.level !== level) {
    settings[host] = { level, since: now };
  }
  await browser.storage.local.set({ [SITE_SETTINGS_KEY]: settings });
  return host;
}

/** Calls back with the site's level whenever the stored settings change. */
export function watchSiteLevel(
  hostOrUrl: string,
  onChange: (level: SiteLevel) => void,
): () => void {
  const listener = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !changes[SITE_SETTINGS_KEY]) return;
    onChange(
      siteLevelFor(
        parseSiteSettings(changes[SITE_SETTINGS_KEY].newValue),
        hostOrUrl,
      ),
    );
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
