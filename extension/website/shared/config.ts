// ABOUTME: Runtime config for wewere.online experiments.
// ABOUTME: Worker base URL + URL-param overrides for experiment settings.

import { parseSpec } from "./utils/settingsSpec";

const DEFAULT_WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";

export const WORKER_URL: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ?? DEFAULT_WORKER_URL;

export const RECENT_EVENTS_URL = `${WORKER_URL}/events/recent`;
export const DAILY_COUNTS_URL = `${WORKER_URL}/events/daily-counts`;
export const PAGE_META_URL = `${WORKER_URL}/page-meta`;

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
