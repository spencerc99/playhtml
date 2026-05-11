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

function parseNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  if (value === null) return undefined;
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const TRAIL_STYLES = ["straight", "smooth", "organic", "chaotic"] as const;
const TRAIL_ANIMATION_MODES = ["natural", "stagger"] as const;
const KEYBOARD_DISPLAY_MODES = ["full", "abstract"] as const;
const NAVIGATION_VIEW_MODES = ["timeline", "radial"] as const;

/**
 * Read experiment settings from the URL query string. Any returned key
 * overrides the corresponding localStorage + default value. Returns only
 * the keys that were actually present — consumers spread over defaults.
 *
 * Supports a focused whitelist of keys that matter for capturing
 * visualization variants as art previews. Add new keys here as you find
 * them worth varying from the capture matrix.
 */
export function parseSettingsFromUrl(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const overrides: Record<string, unknown> = {};

  // Booleans
  const bools: Array<[string, string]> = [
    ["randomizeColors", "randomizeColors"],
    ["documentSpace", "documentSpace"],
    ["soundChordVoicing", "soundChordVoicing"],
    ["soundCursorInstruments", "soundCursorInstruments"],
    ["soundCrossingDissonance", "soundCrossingDissonance"],
  ];
  for (const [param, key] of bools) {
    const v = parseBool(params.get(param));
    if (v !== undefined) overrides[key] = v;
  }

  // Numbers
  const numbers: Array<[string, string]> = [
    ["animationSpeed", "animationSpeed"],
    ["chaosIntensity", "chaosIntensity"],
    ["strokeWidth", "strokeWidth"],
    ["trailOpacity", "trailOpacity"],
    ["maxConcurrentTrails", "maxConcurrentTrails"],
    ["overlapFactor", "overlapFactor"],
    ["minGapBetweenTrails", "minGapBetweenTrails"],
    ["clickMaxGapMs", "clickMaxGapMs"],
    ["backgroundOpacity", "backgroundOpacity"],
    ["scrollSpeed", "scrollSpeed"],
  ];
  for (const [param, key] of numbers) {
    const v = parseNumber(params.get(param));
    if (v !== undefined) overrides[key] = v;
  }

  // Enums
  const trailStyle = parseEnum(params.get("trailStyle"), TRAIL_STYLES);
  if (trailStyle) overrides.trailStyle = trailStyle;

  const trailAnimationMode = parseEnum(
    params.get("trailAnimationMode"),
    TRAIL_ANIMATION_MODES,
  );
  if (trailAnimationMode) overrides.trailAnimationMode = trailAnimationMode;

  const keyboardDisplayMode = parseEnum(
    params.get("keyboardDisplayMode"),
    KEYBOARD_DISPLAY_MODES,
  );
  if (keyboardDisplayMode) overrides.keyboardDisplayMode = keyboardDisplayMode;

  const navigationViewMode = parseEnum(
    params.get("navigationViewMode"),
    NAVIGATION_VIEW_MODES,
  );
  if (navigationViewMode) overrides.navigationViewMode = navigationViewMode;

  // Free strings (passed through without validation)
  const trailVisualStyle = params.get("trailVisualStyle");
  if (trailVisualStyle) overrides.trailVisualStyle = trailVisualStyle;

  // Path filter — see parsePathFromUrl. Threaded through here so it merges
  // into the settings object alongside everything else loaded by
  // MovementCanvas's loadSettings(). Empty string means "no filter".
  const pathFilter = params.get("path");
  if (pathFilter !== null) overrides.pathFilter = pathFilter;

  // Domain filter — same story. Without this, MovementCanvas would init
  // with `domainFilter=""` from localStorage when the URL has
  // `?domain=foo`, then portrait (which DOES read `?domain=`) would push
  // `"foo"` down via the prop sync. Initial-render disagreement creates a
  // brief domain swap until the sync settles. Reading the URL here keeps
  // both sides aligned from frame zero.
  const domainFilter = params.get("domain");
  if (domainFilter !== null) overrides.domainFilter = domainFilter;

  // Per-user filter. The "user" identity is the persistent ECDSA-derived
  // `pid` on each event (NOT the per-browser-session `sid`). Match is
  // exact-string against `event.meta.pid`. Useful for isolating your own
  // browsing in the visualization, or pinning a specific contributor's
  // movement as an art piece.
  const pidFilter = params.get("user");
  if (pidFilter !== null) overrides.pidFilter = pidFilter;

  return overrides;
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

/** `?domain=wikipedia.org` → "wikipedia.org". Returns undefined when absent
 * (caller keeps existing default). Empty string is treated as "no filter". */
export function parseDomainFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("domain");
  return raw === null ? undefined : raw;
}

/** `?path=/maps` → "/maps". Returns undefined when absent. Combined with
 * `domain` to scope a viz to a sub-section of a site. Leading `/` is
 * optional in the filter; matching is prefix-based. */
export function parsePathFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("path");
  return raw === null ? undefined : raw;
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
