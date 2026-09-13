// ABOUTME: Storage shape and pure helpers for the wayfarer journey (the stops a person walked).
// ABOUTME: Shared by the content-script recorder, the background message handlers, and the shell page.

/** browser.storage.local key holding the recorded journey. */
export const WAYFARER_JOURNEY_KEY = "wwoWayfarerJourney";

/** browser.storage.local key holding the widget's collapsed/expanded state. */
export const WAYFARER_WIDGET_KEY = "wwoWayfarerWidget";

/** Most stops we keep; older ones fall off the front. */
export const JOURNEY_CAP = 32;

/** Longest title we persist per stop. */
const TITLE_CAP = 120;

export interface JourneyStop {
  url: string;
  title: string;
  ts: number;
}

export interface Journey {
  stops: JourneyStop[];
  updatedAt: number;
}

export function emptyJourney(): Journey {
  return { stops: [], updatedAt: 0 };
}

/**
 * Canonical form of a visited URL: origin + pathname, no query and no hash.
 * The host is lowercased (URL does that for us) and the port is kept, so two
 * dev servers on the same host stay distinct places. Returns null for anything
 * that is not an http(s) page — extension pages, about:, file:, data:.
 */
export function normalizeStopUrl(raw: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  let pathname = url.pathname || "/";
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/";

  return `${url.origin}${pathname}`;
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, TITLE_CAP);
}

function normalizeStop(value: unknown): JourneyStop | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? normalizeStopUrl(record.url) : null;
  if (!url) return null;
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0;
  return { url, title: normalizeTitle(record.title), ts };
}

/** Tolerant parser for whatever happens to be sitting in storage. */
export function normalizeJourney(value: unknown): Journey {
  if (!value || typeof value !== "object") return emptyJourney();
  const record = value as Record<string, unknown>;
  const rawStops = Array.isArray(record.stops) ? record.stops : [];
  const stops: JourneyStop[] = [];
  for (const raw of rawStops) {
    const stop = normalizeStop(raw);
    if (stop) stops.push(stop);
  }
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return { stops: stops.slice(-JOURNEY_CAP), updatedAt };
}

/**
 * Append a visit to the journey. Revisiting the place you are already standing
 * refreshes that stop instead of adding a duplicate; anything that does not
 * normalize (an extension page, say) leaves the journey untouched.
 */
export function appendStop(
  journey: Journey,
  stop: { url: string; title?: string },
  now: number,
): Journey {
  const url = normalizeStopUrl(stop.url);
  if (!url) return journey;

  const title = normalizeTitle(stop.title);
  const stops = journey.stops.slice();
  const last = stops[stops.length - 1];

  if (last && last.url === url) {
    stops[stops.length - 1] = { url, title: title || last.title, ts: now };
  } else {
    stops.push({ url, title, ts: now });
  }

  return { stops: stops.slice(-JOURNEY_CAP), updatedAt: now };
}

export interface WayfarerWidgetState {
  collapsed: boolean;
}

export function normalizeWidgetState(value: unknown): WayfarerWidgetState {
  if (!value || typeof value !== "object") return { collapsed: false };
  const record = value as Record<string, unknown>;
  return { collapsed: record.collapsed === true };
}
