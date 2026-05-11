// ABOUTME: Builds a minimal shareable URL that captures the current viz config
// ABOUTME: Compares against DEFAULT_SETTINGS so unchanged values stay implicit

import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../components/registry";

/**
 * Map of `settingsKey → { param, viz? }`.
 *   - `param` is the URL key (matches the parsers in `../config.ts`).
 *   - `viz` (optional) restricts the param to runs where that viz id is
 *     active. If `viz` is omitted the param emits whenever its value
 *     differs from the default — useful for cross-cutting things like
 *     `randomizeColors` and the sound config.
 *
 * Keep this in lockstep with `parseSettingsFromUrl` in `../config.ts`. If
 * a setting is added to one, add it to the other.
 */
const SHAREABLE_SETTINGS: Record<string, { param: string; viz?: string }> = {
  // Cross-cutting
  randomizeColors: { param: "randomizeColors" },
  documentSpace: { param: "documentSpace", viz: "trails" },
  soundChordVoicing: { param: "soundChordVoicing" },
  soundCursorInstruments: { param: "soundCursorInstruments" },
  soundCrossingDissonance: { param: "soundCrossingDissonance" },

  // Trails
  animationSpeed: { param: "animationSpeed", viz: "trails" },
  chaosIntensity: { param: "chaosIntensity", viz: "trails" },
  strokeWidth: { param: "strokeWidth", viz: "trails" },
  trailOpacity: { param: "trailOpacity", viz: "trails" },
  maxConcurrentTrails: { param: "maxConcurrentTrails", viz: "trails" },
  overlapFactor: { param: "overlapFactor", viz: "trails" },
  minGapBetweenTrails: { param: "minGapBetweenTrails", viz: "trails" },
  trailStyle: { param: "trailStyle", viz: "trails" },
  trailAnimationMode: { param: "trailAnimationMode", viz: "trails" },
  trailVisualStyle: { param: "trailVisualStyle", viz: "trails" },

  // Clicks
  clickMaxGapMs: { param: "clickMaxGapMs", viz: "clicks" },

  // Scrolling
  backgroundOpacity: { param: "backgroundOpacity", viz: "scrolling" },
  scrollSpeed: { param: "scrollSpeed", viz: "scrolling" },

  // Keyboard
  keyboardDisplayMode: { param: "keyboardDisplayMode", viz: "typing" },

  // Navigation
  navigationViewMode: { param: "navigationViewMode", viz: "navigation" },
};

/** Two arrays are "equal" for sharing purposes if they hold the same ids
 * regardless of order. Defaults are sorted, so we sort both before
 * comparing. */
function sameVizSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export interface BuildShareUrlInput {
  settings: Record<string, unknown>;
  defaults: Record<string, unknown>;
  activeVisualizations: string[];
  selectedTimeRange: { startMs: number; endMs: number } | null;
  /** Optional override; defaults to current `window.location.origin + pathname`. */
  baseUrl?: string;
  /** Clean-presentation level to embed in the URL.
   *   - `false` / `0`: omit `clean` param entirely.
   *   - `true` / `1` (basic): `?clean=1` — hides sound + readouts.
   *   - `2` (print): `?clean=2` — also hides metadata pill + DaySelector.
   * See `CleanLevel` in `../config.ts` for the full semantics. */
  clean?: boolean | 0 | 1 | 2;
}

/**
 * Compose a minimal shareable URL for the current canvas configuration.
 *
 * Only emits params that diverge from defaults. Per-viz params are
 * omitted when their viz isn't active — sharing a "trails" config doesn't
 * leak the navigation/keyboard sliders. Domain and path filters always
 * emit when set; time range emits as `startMs`/`endMs`.
 */
export function buildShareUrl({
  settings,
  defaults,
  activeVisualizations,
  selectedTimeRange,
  baseUrl,
  clean,
}: BuildShareUrlInput): string {
  const base =
    baseUrl ??
    (typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}`);
  const url = new URL(base || "http://placeholder/");

  const vizSet = new Set(activeVisualizations);

  // viz: emit when it differs from the registry's defaults.
  if (!sameVizSet(activeVisualizations, DEFAULT_ACTIVE_VISUALIZATIONS)) {
    url.searchParams.set("viz", activeVisualizations.join(","));
  }

  // domain / path / pid / time range — always emit when set.
  const domain = (settings.domainFilter as string | undefined) ?? "";
  if (domain) url.searchParams.set("domain", domain);

  const path = (settings.pathFilter as string | undefined) ?? "";
  if (path) url.searchParams.set("path", path);

  const pid = (settings.pidFilter as string | undefined) ?? "";
  if (pid) url.searchParams.set("user", pid);

  if (selectedTimeRange) {
    url.searchParams.set("startMs", String(selectedTimeRange.startMs));
    url.searchParams.set("endMs", String(selectedTimeRange.endMs));
  }

  // Per-setting diffs against defaults, gated on the relevant viz.
  for (const [key, spec] of Object.entries(SHAREABLE_SETTINGS)) {
    if (spec.viz && !vizSet.has(spec.viz)) continue;
    const current = settings[key];
    const def = defaults[key];
    if (current === undefined || current === def) continue;
    url.searchParams.set(spec.param, String(current));
  }

  // Embed the chosen clean level. `true` is legacy shorthand for level 1.
  const cleanLevel =
    clean === true ? 1 : typeof clean === "number" ? clean : 0;
  if (cleanLevel > 0) url.searchParams.set("clean", String(cleanLevel));

  // When `baseUrl` was a placeholder (no window), strip the scheme so the
  // caller can't accidentally surface "http://placeholder/" — return just
  // the search portion.
  if (!base) return `?${url.searchParams.toString()}`;

  return url.toString();
}
