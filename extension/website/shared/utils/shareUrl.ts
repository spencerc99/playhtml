// ABOUTME: Builds a minimal shareable URL that captures the current viz config
// ABOUTME: Spec-driven — see settingsSpec.ts. Two-line update to add a new key.

import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../components/registry";
import { serializeSpec, SETTINGS_BLOB_PARAM } from "./settingsSpec";

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
  /** Effective defaults for this route. */
  settingsDefaults?: Record<string, unknown>;
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
 * The per-setting diff vs. defaults lives in `serializeSpec` (declarative
 * spec at `./settingsSpec.ts`). This function just adds the few one-off
 * params that aren't settings-shaped: `viz`, `startMs`/`endMs`, `clean`.
 *
 * Per-viz settings are omitted when their viz isn't active — sharing a
 * "trails" config doesn't leak the navigation/keyboard sliders.
 */
export function buildShareUrl({
  settings,
  settingsDefaults,
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

  // Active vizs: emit when they differ from the registry's defaults.
  if (!sameVizSet(activeVisualizations, DEFAULT_ACTIVE_VISUALIZATIONS)) {
    url.searchParams.set("viz", activeVisualizations.join(","));
  }

  // Spec-driven per-setting diff. Headline params (filters, trail style,
  // viz mode, etc.) get their own readable URL keys; everything else
  // diverging from defaults rides in a single base64 blob (`?s=...`) so
  // URLs stay bounded as the settings tree grows.
  const { headline, blob } = serializeSpec(settings, vizSet, settingsDefaults);
  for (const [param, value] of Object.entries(headline)) {
    url.searchParams.set(param, value);
  }
  if (blob) url.searchParams.set(SETTINGS_BLOB_PARAM, blob);

  // Time range — not a setting, lives in canvas state.
  if (selectedTimeRange) {
    url.searchParams.set("startMs", String(selectedTimeRange.startMs));
    url.searchParams.set("endMs", String(selectedTimeRange.endMs));
  }

  // Embed the chosen clean level. `true` is legacy shorthand for level 1.
  const cleanLevel =
    clean === true ? 1 : typeof clean === "number" ? clean : 0;
  if (cleanLevel > 0) url.searchParams.set("clean", String(cleanLevel));

  // Preserve capture/scope params that aren't settings-shaped, so the URL
  // rewrite (which reconstructs from settings) doesn't drop them. These are
  // the day selection, the recurring time-of-day window, and the cinematic
  // camera family — all of which a capture link needs to survive reload.
  if (typeof window !== "undefined") {
    const current = new URLSearchParams(window.location.search);
    const PRESERVE = [
      "day",
      "tod",
      "todRadius",
      "cinematic",
      "cinemaZoom",
      "cinemaTransition",
      "cinemaLerp",
      "cinemaVelZoom",
      "cinemaReveal",
      "cinemaStartZoom",
      "role",
      "follower",
    ];
    for (const key of PRESERVE) {
      const val = current.get(key);
      if (val !== null) url.searchParams.set(key, val);
    }
  }

  // When `baseUrl` was a placeholder (no window), strip the scheme so the
  // caller can't accidentally surface "http://placeholder/" — return just
  // the search portion.
  if (!base) return `?${url.searchParams.toString()}`;

  return url.toString();
}
