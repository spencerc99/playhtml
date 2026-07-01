// ABOUTME: Settings defaults for MovementCanvas, extracted so utilities
// ABOUTME: like the share-URL builder can compare against them without a cycle.

import { CLICK_DEFAULTS } from "./clickDefaults";
import type { FilterChip } from "../utils/eventUtils";

/** Settings defaults — extracted so the share-URL builder can compare
 * against them and only emit params that diverge. Keep this in sync with
 * `parseSettingsFromUrl` in `../config.ts` (anything you want shareable
 * needs both a default here and a parser there). */
export const DEFAULT_SETTINGS = {
  trailOpacity: 0.7,
  strokeWidth: 5,
  animationSpeed: 1,
  trailStyle: "chaotic" as "straight" | "smooth" | "organic" | "chaotic",
  maxConcurrentTrails: 15,
  trailAnimationMode: "stagger" as "natural" | "stagger",
  overlapFactor: 0.8,
  randomizeColors: false,
  minGapBetweenTrails: 0.3,
  chaosIntensity: 1.0,
  ...CLICK_DEFAULTS,
  eventFilter: {
    move: true,
    click: true,
    hold: true,
    cursor_change: true,
  },
  viewportEventFilter: {
    scroll: true,
    resize: true,
    zoom: true,
  },
  /** URL-scope filter chips. Each chip is an OR with the others; the empty
   * array means "no filter, match all events." A chip with only `domain`
   * is exact-host match; with only `path` is prefix-match on any host;
   * with both, host AND path-prefix. Replaces the old single
   * `domainFilter` / `pathFilter` string pair. */
  filters: [] as FilterChip[],
  pidFilter: "",
  documentSpace: false,
  scrollSpeed: 1.0,
  backgroundOpacity: 0.7,
  maxConcurrentScrolls: 5,
  showPagePreview: false,
  allowOverlap: false,
  // When overlap is allowed, how far viewports may hang off any canvas edge
  // (as a fraction of their own size). 0 = stay inside, 1 = up to fully
  // off-screen. Higher values give better corner coverage at the cost of
  // some viewports being partly clipped.
  windowBleed: 0.45,
  // Browser-chrome title bar on top of each viewport window (favicon + page
  // title). Defaults on; the bar is informative for portraits but you may
  // want it off for clean captures.
  showTitleBar: true,
  showScrollEvents: true,
  showResizeEvents: true,
  showZoomEvents: true,
  windowScale: 0.5,
  keyboardOverlapFactor: 0.9,
  textboxOpacity: 0.2,
  keyboardMinFontSize: 12,
  keyboardMaxFontSize: 18,
  keyboardShowCaret: true,
  keyboardAnimationSpeed: 0.5,
  keyboardPositionRandomness: 0.3,
  keyboardRandomizeOrder: false,
  /** 0–100% legibility for typing-viz playback. 100 = full text (PII
   * still redacted), 0 = cadence only (every non-whitespace replaced
   * with U+2588), in between mixes deterministically. Mirrors the
   * extension's collection-time legibility setting. */
  keyboardLegibilityPct: 100,
  // Hard cap on actively-typing sessions on screen at once. Once full,
  // additional sessions defer until a slot frees. Recently-completed
  // sessions still linger via the visualization's completed-tail buffer.
  maxConcurrentTyping: 15,
  // Max box size as a fraction of viewport (width and height). Captured
  // inputs are clamped to `viewport.w * scale` and `viewport.h * scale *
  // 0.8`. 1.0 disables clamping entirely (raw captured sizes — Google Docs
  // pages or ChatGPT containers may span the canvas). 0.5 is a good
  // balance for most cases. Smaller = tighter.
  keyboardSizeCap: 0.5,
  navigationWindowOpacity: 0.9,
  navigationEdgeOpacity: 0.2,
  navigationScrollSpeed: 80,
  navigationMaxSessions: 8,
  navigationMinSessionEvents: 3,
  navigationViewMode: "timeline" as "timeline" | "radial",
  navigationMaxParallelEdges: 3,
  navigationRadialBlobSamples: 64,
  navigationRadialBlobCurveTension: 0.5,
  navigationRadialBlobEdgeNoise: 0.45,
  navigationRadialBlobValleyDepth: 0.05,
  navigationRadialSegmentByDay: true,
  trailVisualStyle: "color",
  soundChordVoicing: true,
  soundCursorInstruments: true,
  soundCrossingDissonance: false,
  // Debug-mode hover: when on, viz items become hoverable and the canvas
  // shows a tooltip with details about the data point under the cursor.
  // Session-only by default — handy when poking at a configuration, not a
  // setting you'd want baked into a saved/shared URL.
  debugMode: false,
};
