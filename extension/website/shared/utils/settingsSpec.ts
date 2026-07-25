// ABOUTME: Hybrid URL encoding for canvas settings.
// ABOUTME: Headline params stay readable; everything else lives in a ?s= blob.

import { DEFAULT_SETTINGS } from "../components/settingsDefaults";
import {
  parseFilterChip,
  formatFilterChip,
  type FilterChip,
} from "./eventUtils";

/** A headline param has a friendly URL key + per-value parse/serialize
 * helpers. These are the params that should remain hand-editable in the
 * address bar — domain/path/user filters, the most art-affecting trail
 * knobs, etc.
 *
 *   key       — property name in the settings object.
 *   param     — query-string key in the URL.
 *   parse     — string → typed value, or `undefined` to ignore.
 *   serialize — typed value → string, or `null` to omit from the URL.
 *               Called only when the value differs from `DEFAULT_SETTINGS[key]`.
 *   viz       — optional viz id; the share-URL builder omits this entry
 *               when that viz isn't active. The parser is unconditional —
 *               stray params don't break anything.
 *
 * Adding a setting to the headline list takes one entry here. Everything
 * else (every other key in DEFAULT_SETTINGS) is automatically carried in
 * the opaque `?s=` blob without further spec maintenance.
 */
export interface SettingSpec {
  key: string;
  param: string;
  parse(raw: string): unknown | undefined;
  serialize(value: unknown): string | null;
  viz?: string;
}

/** Single URL param that carries every non-headline diverging-from-default
 * setting as a base64-encoded JSON blob. The point of using a single param
 * (rather than auto-discovery in the future) is keeping the URL recognizable
 * — a sharer can see `?s=…` and know "there's a config blob here." */
const BLOB_PARAM = "s";

// ── shared parsers/serializers ──────────────────────────────────────────────

function parseBool(raw: string): boolean | undefined {
  const v = raw.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function parseNumber(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseEnum<T extends string>(
  allowed: readonly T[],
): (raw: string) => T | undefined {
  return (raw) =>
    (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

const bool = (key: string, param: string, viz?: string): SettingSpec => ({
  key,
  param,
  viz,
  parse: parseBool,
  serialize: (v) => (typeof v === "boolean" ? String(v) : null),
});

const num = (key: string, param: string, viz?: string): SettingSpec => ({
  key,
  param,
  viz,
  parse: parseNumber,
  serialize: (v) => (typeof v === "number" ? String(v) : null),
});

function enumSpec<T extends string>(
  key: string,
  param: string,
  allowed: readonly T[],
  viz?: string,
): SettingSpec {
  return {
    key,
    param,
    viz,
    parse: parseEnum(allowed),
    serialize: (v) => (typeof v === "string" ? v : null),
  };
}

// ── headline params ─────────────────────────────────────────────────────────

const TRAIL_STYLES = ["straight", "smooth", "organic", "chaotic"] as const;
const TRAIL_ANIMATION_MODES = ["natural", "stagger"] as const;
const NAVIGATION_VIEW_MODES = ["timeline", "radial"] as const;
const TRAIL_VISUAL_STYLES = ["color", "monochrome"] as const;

/** The small set of settings whose URL representation should stay
 * readable / hand-editable. Everything else rides in the `?s=` blob.
 * Pick keys that:
 *   - someone might want to type into the address bar directly,
 *   - significantly change what the canvas shows, or
 *   - are the "headline" of a shared link (filters, viz, presentation tier).
 */
export const HEADLINE_SPECS: SettingSpec[] = [
  // Filters — always shareable, always readable. The chip list serializes
  // as `?filter=google.com,reddit.com/r/foo,/maps` — one canonical-form
  // token per chip joined with commas. Legacy `?domain=` and `?path=` are
  // accepted as a fold-in (see parseSpec).
  {
    key: "filters",
    param: "filter",
    parse: (raw) => {
      if (typeof raw !== "string") return undefined;
      if (raw === "") return [] as FilterChip[];
      const chips = raw
        .split(",")
        .map((s) => parseFilterChip(s))
        .filter((c) => c.domain || c.path);
      return chips;
    },
    serialize: (v) => {
      if (!Array.isArray(v) || v.length === 0) return null;
      const tokens = (v as FilterChip[])
        .map(formatFilterChip)
        .filter(Boolean);
      return tokens.length > 0 ? tokens.join(",") : null;
    },
  },
  {
    key: "pidFilter",
    param: "user",
    parse: (r) => r,
    serialize: (v) => (typeof v === "string" && v !== "" ? v : null),
  },

  // Trails — the knobs that visibly change what the trail looks like.
  enumSpec("trailStyle", "trailStyle", TRAIL_STYLES, "trails"),
  // Color vs monochrome — drives cursors AND the window/typing visualizations.
  enumSpec("trailVisualStyle", "trailVisualStyle", TRAIL_VISUAL_STYLES),
  enumSpec(
    "trailAnimationMode",
    "trailAnimationMode",
    TRAIL_ANIMATION_MODES,
    "trails",
  ),
  num("animationSpeed", "animationSpeed", "trails"),
  num("strokeWidth", "strokeWidth", "trails"),
  num("trailOpacity", "trailOpacity", "trails"),
  bool("randomizeColors", "randomizeColors"),

  // Navigation — view mode is structurally different (timeline vs radial),
  // so it makes sense to call it out in the URL.
  enumSpec(
    "navigationViewMode",
    "navigationViewMode",
    NAVIGATION_VIEW_MODES,
    "navigation",
  ),
];

// ── parsing ────────────────────────────────────────────────────────────────

/** Decode the `?s=<base64-json>` blob if present. Tolerant of malformed
 * input — returns `{}` rather than throwing so a bad share link doesn't
 * brick the page. */
function decodeBlob(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    // URL-safe base64 in (- and _ as alternates), then JSON. We emit
    // standard base64 ourselves but accept both flavors for robustness.
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "===".slice((normalized.length + 3) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (err) {
    console.warn("Ignoring malformed ?s= blob:", err);
    return {};
  }
}

/** Parse all URL-encoded settings: blob first, then headline params on top
 * so explicit hand-edited params always win. Returns a sparse override
 * object that the caller spreads onto defaults. */
export function parseSpec(params: URLSearchParams): Record<string, unknown> {
  const overrides: Record<string, unknown> = {
    ...decodeBlob(params.get(BLOB_PARAM)),
  };
  for (const spec of HEADLINE_SPECS) {
    const raw = params.get(spec.param);
    if (raw === null) continue;
    const parsed = spec.parse(raw);
    if (parsed === undefined) continue;
    overrides[spec.key] = parsed;
  }

  // Legacy fold-in: previously the URL carried `?domain=...&path=...` as
  // two separate single-value params. Today the chip list owns this slot.
  // When `?filter=` is absent but the legacy pair is present, fold them
  // into a single chip so old share links continue to work.
  if (!params.has("filter") && (params.has("domain") || params.has("path"))) {
    const domain = params.get("domain") ?? "";
    const path = params.get("path") ?? "";
    if (domain || path) {
      overrides.filters = [{ domain, path }] satisfies FilterChip[];
    }
  }

  return overrides;
}

// ── serializing ────────────────────────────────────────────────────────────

/** Deep-ish equality. Used to decide whether a setting still matches its
 * default value (and therefore should NOT be emitted). Handles JSON-shaped
 * data, which is what settings are — no functions, no cycles. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  // JSON.stringify is stable enough here because settings objects are
  // small, the order is controlled by us, and we never compare arbitrary
  // user input — the structures are well-known.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Encode a JSON-able object to URL-safe base64. */
function encodeBlob(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj);
  // btoa works on latin-1; settings are all ASCII so this is safe. URL-safe
  // alternates (-, _) keep the string from needing extra encoding when it
  // lives in a query string.
  return btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface SerializeResult {
  /** Headline params, ready to write into `URLSearchParams.set`. */
  headline: Record<string, string>;
  /** Single `s` param value, or `null` when nothing diverges. */
  blob: string | null;
}

/** Serialize the diff between `settings` and the route's effective defaults into a
 * `{headline, blob}` pair. The caller decides where to place each in the
 * URL. Per-viz headline params drop out when their viz isn't active —
 * sharing a trails config doesn't leak the navigation sliders.
 *
 * Everything that diverges and isn't a headline key rides in the blob,
 * including settings not declared in `HEADLINE_SPECS` at all. So the blob
 * is automatically future-proof: add a new setting to the effective defaults
 * and it round-trips through share URLs with no other code change. */
export function serializeSpec(
  settings: Record<string, unknown>,
  activeVizIds: ReadonlySet<string>,
  settingsDefaults: Record<string, unknown> = DEFAULT_SETTINGS,
): SerializeResult {
  const headline: Record<string, string> = {};
  const blob: Record<string, unknown> = {};
  const defaults = settingsDefaults;

  // 1) Headline pass — only emit if it would also pass the viz gate.
  for (const spec of HEADLINE_SPECS) {
    if (spec.viz && !activeVizIds.has(spec.viz)) continue;
    const value = settings[spec.key];
    if (value === undefined) continue;
    if (valuesEqual(value, defaults[spec.key])) continue;
    const serialized = spec.serialize(value);
    if (serialized === null) continue;
    headline[spec.param] = serialized;
  }

  // 2) Blob pass — walk every default key. The skip rule is "did headline
  // actually emit this one?", NOT "is this a headline key at all". The
  // difference matters for viz-gated headline keys (like `trailStyle`):
  // when its viz isn't active the headline gate drops it. Without this
  // fall-through, the value would vanish from the URL entirely — bad for
  // the "toggle viz off, then back on, restore tweaks across reload" flow.
  // Letting it ride in the blob keeps the value safely round-tripping
  // regardless of which vizs are currently shown.
  const headlineKeysEmitted = new Set<string>();
  for (const spec of HEADLINE_SPECS) {
    if (spec.param in headline) headlineKeysEmitted.add(spec.key);
  }
  for (const key of Object.keys(defaults)) {
    if (headlineKeysEmitted.has(key)) continue;
    const value = settings[key];
    if (value === undefined) continue;
    if (valuesEqual(value, defaults[key])) continue;
    blob[key] = value;
  }

  return {
    headline,
    blob: Object.keys(blob).length === 0 ? null : encodeBlob(blob),
  };
}

export const SETTINGS_BLOB_PARAM = BLOB_PARAM;
