// ABOUTME: Runtime config for wewere.online experiments.
// ABOUTME: Worker base URL + URL-param overrides for experiment settings.

import { parseSpec } from "./utils/settingsSpec";
import {
  DEFAULT_CINEMATIC_CONFIG,
  type CinematicConfig,
} from "./utils/cinematicCamera";

const DEFAULT_WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";

export const WORKER_URL: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ?? DEFAULT_WORKER_URL;

export const RECENT_EVENTS_URL = `${WORKER_URL}/events/recent`;
export const DAILY_COUNTS_URL = `${WORKER_URL}/events/daily-counts`;
export const PAGE_META_URL = `${WORKER_URL}/page-meta`;

/** WebSocket endpoint for the live cursor-event stream. Derived from
 * WORKER_URL by swapping the http(s) scheme for ws(s). */
export const STREAM_URL = `${WORKER_URL.replace(/^http/, "ws")}/stream`;

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Read experiment settings from the URL query string. Pure delegation to
 * `parseSpec` — every URL-encodable setting is declared in
 * `utils/settingsSpec.ts`, which both this parser and `buildShareUrl`
 * consume. Adding a new shareable setting takes exactly one entry in the
 * spec. */
export function parseSettingsFromUrl(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  return parseSpec(new URLSearchParams(window.location.search));
}

/** Comma-separated `?viz=trails,clicks,navigation` → string[] of viz ids.
 * Returns undefined when the param is absent so callers can fall back to
 * localStorage / defaults. Empty string clears the list explicitly. */
export function parseVizFromUrl(): string[] | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("viz");
  if (raw === null) return undefined;
  if (raw === "") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Standalone parser for the filter chip list. Reads the new `?filter=`
 * token list and falls back to legacy `?domain=`/`?path=` so old share
 * links still work. Returns undefined when nothing is present so callers
 * can keep their own default. Kept separate from `parseSettingsFromUrl`
 * so `portrait.tsx` can seed its top-level filter state without pulling
 * in the whole settings tree. */
export function parseFiltersFromUrl():
  | { domain: string; path: string }[]
  | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);

  const raw = params.get("filter");
  if (raw !== null) {
    if (raw === "") return [];
    // Tiny re-implementation of parseFilterChip to keep this helper free
    // of cross-module imports — same heuristics, kept in sync intentionally.
    return raw
      .split(",")
      .map((token) => {
        const trimmed = token.trim();
        if (!trimmed) return null;
        const stripped = trimmed.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "");
        const slashIdx = stripped.indexOf("/");
        const head = slashIdx === -1 ? stripped : stripped.slice(0, slashIdx);
        const tail = slashIdx === -1 ? "" : stripped.slice(slashIdx);
        if (head.includes(".")) {
          return { domain: head.replace(/^www\./, ""), path: tail };
        }
        if (!stripped) return null;
        return { domain: "", path: stripped.startsWith("/") ? stripped : `/${stripped}` };
      })
      .filter((c): c is { domain: string; path: string } => c !== null && (!!c.domain || !!c.path));
  }

  // Legacy fold-in for already-shared links.
  const domain = params.get("domain");
  const path = params.get("path");
  if (domain !== null || path !== null) {
    return [{ domain: domain ?? "", path: path ?? "" }];
  }

  return undefined;
}

/** Clean-presentation tier. Higher numbers hide more chrome.
 *
 *   0 (off)
 *     Full dev experience. Sound toggle, time readouts, metadata pill,
 *     and DaySelector all visible. This is the default when `?clean` is
 *     absent.
 *
 *   1 (basic)  ← `?clean=1`
 *     Hides interactive chrome that doesn't belong on a shared link:
 *       - Sound toggle button (top-right)
 *       - NaturalTimeReadout (top-center live clock)
 *       - SelectedRangeReadout (top-center time-range pill)
 *     Keeps metadata so the viewer knows what they're looking at:
 *       - Domain / path / user filter pill (top-right)
 *       - DaySelector (bottom-left)
 *     Used by `Cmd+Shift+S` PNG capture and most share links.
 *
 *   2 (print) ← `?clean=2`
 *     Everything in `basic`, plus the metadata-bearing chrome too:
 *       - Domain / path / user pill — hidden
 *       - DaySelector — hidden
 *     The canvas reads as a finished print/gallery piece — only the
 *     "we were online" wordmark in `portrait.tsx` remains as a signature.
 *     Use this for art-piece exports where the URL params themselves
 *     are the metadata record.
 *
 * The save-image flow (`handleCapture`) transiently sets level 1 during
 * the PNG capture; if you want print-level PNGs, add `?clean=2` to the
 * URL before saving, or save from a link that already has it.
 */
export type CleanLevel = 0 | 1 | 2;

export function parseCleanFromUrl(): CleanLevel {
  if (typeof window === "undefined") return 0;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("clean");
  if (raw === null) return 0;
  if (raw === "2") return 2;
  if (parseBool(raw) === true || raw === "1") return 1;
  return 0;
}

/** `?startMs=...&endMs=...` → selectedTimeRange. Both must be present and
 * numeric, with end > start, otherwise returns undefined. */
export function parseTimeRangeFromUrl():
  | { startMs: number; endMs: number }
  | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const startMs = parseNumber(params.get("startMs"));
  const endMs = parseNumber(params.get("endMs"));
  if (startMs === undefined || endMs === undefined) return undefined;
  if (endMs <= startMs) return undefined;
  return { startMs, endMs };
}

/** `?day=YYYY-MM-DD` → the archive day to fetch, or undefined when absent.
 * Lets a capture URL pin a specific historical day (e.g. to source a past
 * midnight window) without clicking the calendar. */
export function parseDayFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("day");
  if (raw === null) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

/** A recurring time-of-day window, expressed in minutes from local midnight.
 * Unlike `selectedTimeRange` (one absolute span), this matches the same
 * time-of-day across EVERY day in the data — e.g. "within 15 min of midnight,
 * every night." `centerMinutes` is minutes after local 00:00 (so 0 = midnight,
 * 750 = 12:30pm); `radiusMinutes` is the half-width on either side. */
export interface TimeOfDayFilter {
  centerMinutes: number;
  radiusMinutes: number;
}

/** Parse `?tod=HH:MM&todRadius=15` into a recurring time-of-day window in LOCAL
 * time. Returns undefined when `?tod` is absent. `todRadius` defaults to 15.
 * Accepts `?tod=00:00` or a bare minute count (`?tod=0`). */
export function parseTimeOfDayFromUrl(): TimeOfDayFilter | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const rawTod = params.get("tod");
  if (rawTod === null) return undefined;

  let centerMinutes: number | undefined;
  if (rawTod.includes(":")) {
    const [hh, mm] = rawTod.split(":");
    const h = Number(hh);
    const m = Number(mm);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      centerMinutes = ((h * 60 + m) % 1440 + 1440) % 1440;
    }
  } else {
    const n = Number(rawTod);
    if (Number.isFinite(n)) centerMinutes = ((n % 1440) + 1440) % 1440;
  }
  if (centerMinutes === undefined) return undefined;

  const radius = parseNumber(params.get("todRadius"));
  const radiusMinutes =
    radius !== undefined && radius > 0 ? Math.min(720, radius) : 15;

  return { centerMinutes, radiusMinutes };
}

/** `?role=master`/`follower` marks this window as part of the multi-screen
 * installation. Both roles compute animation time from a shared wall-clock
 * epoch; `follower` additionally participates in cinematic follow coordination.
 * Returns null when the param is absent (a standalone window drives its own
 * clock). */
export function parseInstallationRoleFromUrl(): "master" | "follower" | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("role");
  if (raw === "master") return "master";
  if (raw === "follower") return "follower";
  return null;
}

/** `?follower=<id>` is the stable id a follower window uses to claim cursors in
 * the coordinated auto-follow protocol (so no two follower screens ride the same
 * cursor). Any non-empty string works (e.g. `a`, `b`, `1`, `2`). Returns null
 * when absent — the coordination hook then falls back to a per-window random id
 * so it still participates without a URL-set id. */
export function parseFollowerIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("follower");
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** `?cinematic=1`/`follow` enables cursor-follow; `?cinematic=reveal` runs the
 * one-shot scripted pull-back (tight close-up → full canvas). Optional tuning:
 *   ?cinemaZoom=0.25        follow: fraction of screen width visible
 *   ?cinemaTransition=3     follow: fly-through seconds between subjects
 *   ?cinemaLerp=0           follow: center smoothing (0 = pure locked-center)
 *   ?cinemaVelZoom=0        follow: velocity-aware zoom-out (0 = off)
 *   ?cinemaReveal=10        reveal: seconds to pull back to full canvas
 *   ?cinemaStartZoom=0.18   reveal: fraction of screen width at the tightest
 *   ?follow=5               follow: lock onto trail index 5 (only takes effect
 *                           in follow mode; ignored by reveal)
 * Returns null when cinematic mode is not requested. */
export function parseCinematicFromUrl(): CinematicConfig | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("cinematic");
  const on = raw !== null && raw !== "" && parseBool(raw) !== false;
  if (!on) return null;

  const mode = raw === "reveal" ? "reveal" : "follow";
  const zoom = parseNumber(params.get("cinemaZoom"));
  const transitionS = parseNumber(params.get("cinemaTransition"));
  const lerp = parseNumber(params.get("cinemaLerp"));
  const velZoom = parseNumber(params.get("cinemaVelZoom"));
  const revealS = parseNumber(params.get("cinemaReveal"));
  const startZoom = parseNumber(params.get("cinemaStartZoom"));
  const followRaw = parseNumber(params.get("follow"));
  const forcedSubjectIndex =
    followRaw !== undefined && Number.isInteger(followRaw) && followRaw >= 0
      ? followRaw
      : null;

  return {
    ...DEFAULT_CINEMATIC_CONFIG,
    mode,
    zoom: zoom !== undefined && zoom > 0 ? zoom : DEFAULT_CINEMATIC_CONFIG.zoom,
    transitionMs:
      transitionS !== undefined && transitionS > 0
        ? transitionS * 1000
        : DEFAULT_CINEMATIC_CONFIG.transitionMs,
    centerLerp:
      lerp !== undefined && lerp >= 0
        ? lerp
        : DEFAULT_CINEMATIC_CONFIG.centerLerp,
    velocityZoomOut:
      velZoom !== undefined && velZoom >= 0
        ? velZoom
        : DEFAULT_CINEMATIC_CONFIG.velocityZoomOut,
    revealMs:
      revealS !== undefined && revealS > 0
        ? revealS * 1000
        : DEFAULT_CINEMATIC_CONFIG.revealMs,
    revealStartZoom:
      startZoom !== undefined && startZoom > 0
        ? startZoom
        : DEFAULT_CINEMATIC_CONFIG.revealStartZoom,
    forcedSubjectIndex,
  };
}
