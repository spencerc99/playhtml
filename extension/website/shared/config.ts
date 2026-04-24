// ABOUTME: Runtime config for wewere.online experiments.
// ABOUTME: Worker base URL + URL-param overrides for experiment settings.

const DEFAULT_WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";

export const WORKER_URL: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ?? DEFAULT_WORKER_URL;

export const RECENT_EVENTS_URL = `${WORKER_URL}/events/recent`;
export const DAILY_COUNTS_URL = `${WORKER_URL}/events/daily-counts`;

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/**
 * Read experiment settings from the URL query string. Any returned key
 * overrides the corresponding localStorage + default value. Returns only
 * the keys that were actually present — consumers spread over defaults.
 */
export function parseSettingsFromUrl(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const overrides: Record<string, unknown> = {};

  const randomizeColors = parseBool(params.get("randomizeColors"));
  if (randomizeColors !== undefined) overrides.randomizeColors = randomizeColors;

  return overrides;
}
