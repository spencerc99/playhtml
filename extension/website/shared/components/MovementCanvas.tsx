// ABOUTME: Rendering component for the Internet Movement visualization
// ABOUTME: Accepts events + fetch callback as props; owns settings state and all animation hooks

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { CollectionEvent, Trail } from "../types";
import { Controls } from "./Controls";
import { AnimatedTrails } from "./AnimatedTrails";
import { LiveTrails } from "./LiveTrails";
import { LiveIndicator } from "./LiveIndicator";
import { SoundEngine } from "../sound/SoundEngine";
import { AnimatedClicks, type ScheduledClick } from "./AnimatedClicks";
import { AnimatedTyping } from "./AnimatedTyping";
import { AnimatedScrollViewports } from "./AnimatedScrollViewports";
import { AnimatedNavigation } from "./AnimatedNavigation";
import { AnimatedNavigationRadial } from "./AnimatedNavigationRadial";
import { FaviconPortrait } from "./FaviconPortrait";
import { DaySelector } from "./DaySelector";
import { ActivityStrip } from "./ActivityStrip";
import { StatsConsole } from "./StatsConsole";
import { DebugHoverProvider } from "./DebugHover";
import { useCursorTrails } from "../hooks/useCursorTrails";
import { useAccumulatedEvents } from "../hooks/useAccumulatedEvents";
import { useKeyboardTyping } from "../hooks/useKeyboardTyping";
import { useViewportScroll } from "../hooks/useViewportScroll";
import { usePageMetaFallback } from "../hooks/usePageMetaFallback";
import { useNavigationTimeline } from "../hooks/useNavigationTimeline";
import { useNavigationRadial } from "../hooks/useNavigationRadial";
import {
  extractDomain,
  formatFilterChip,
  summarizeActiveLocations,
  type FilterChip,
} from "../utils/eventUtils";
import { buildShareUrl } from "../utils/shareUrl";
import { getTrailRenderer } from "../styles/trailRenderers";
import {
  parseSettingsFromUrl,
  parseTimeRangeFromUrl,
  parseCleanFromUrl,
  parseCinematicFromUrl,
  parseTimeOfDayFromUrl,
  type TimeOfDayFilter,
} from "../config";
import type { DayCounts } from "../types";
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import {
  DEFAULT_CINEMATIC_CONFIG,
  type CinematicConfig,
} from "../utils/cinematicCamera";

export { CLICK_DEFAULTS } from "./clickDefaults";

const EMPTY_EVENTS: CollectionEvent[] = [];

const READOUT_WRAPPER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "20px",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 100,
  padding: "10px 16px",
  background: "#faf9f6",
  border: "1px solid rgba(0, 0, 0, 0.12)",
  boxShadow:
    "inset 1px 1px 2px rgba(255, 255, 255, 0.8), inset -1px -1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)",
  fontFamily: '"Martian Mono", "Space Mono", "Courier New", monospace',
  fontSize: "11px",
  fontWeight: 600,
  color: "#333",
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  overflow: "hidden",
};

const ReadoutNoise: React.FC<{ id: string }> = ({ id }) => (
  <svg
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      opacity: 0.15,
      pointerEvents: "none",
    }}
  >
    <filter id={id}>
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" />
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncA type="discrete" tableValues="0 0.3 0.5 0.7" />
      </feComponentTransfer>
    </filter>
    <rect width="100%" height="100%" filter={`url(#${id})`} />
  </svg>
);

/** Live clock readout shown when trails play in their natural-timestamp order.
 * Mirrors AnimatedTrails' `(realElapsed * speed) % duration` math so the time
 * shown tracks whatever moment is currently being drawn. Owns its own rAF and
 * writes directly to a ref to avoid per-frame React re-renders. */
const NaturalTimeReadout: React.FC<{
  startTimestampMs: number;
  durationMs: number;
  animationSpeed: number;
}> = ({ startTimestampMs, durationMs, animationSpeed }) => {
  const textRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef(animationSpeed);
  useEffect(() => {
    speedRef.current = animationSpeed;
  }, [animationSpeed]);

  useEffect(() => {
    if (!durationMs || !startTimestampMs) return;
    let raf = 0;
    let timeout = 0;
    let startedAt: number | null = null;

    const formatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const tick = (ts: number) => {
      if (startedAt === null) startedAt = ts;
      const realElapsed = ts - startedAt;
      const looped = (realElapsed * speedRef.current) % durationMs;
      const node = textRef.current;
      if (node) {
        node.textContent = formatter.format(
          new Date(startTimestampMs + looped),
        );
      }
      schedule();
    };

    const schedule = () => {
      if (document.visibilityState === "hidden") {
        timeout = window.setTimeout(() => tick(performance.now()), 250);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };

    schedule();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [startTimestampMs, durationMs]);

  return (
    <div style={{ ...READOUT_WRAPPER_STYLE, pointerEvents: "none" }}>
      <ReadoutNoise id="timeNoise" />
      <span ref={textRef} style={{ position: "relative", zIndex: 1 }} />
    </div>
  );
};

/** Static readout for a user-selected time range — replaces the live clock
 * when a hotspot has scoped the canvas. Visually matches the DaySelector
 * pill (light cream, subtle border, monospace) so the bottom-left date
 * pill and this top-center time-range pill read as a coordinated pair.
 * Date is intentionally omitted — DaySelector already shows it. */
const SelectedRangeReadout: React.FC<{
  startMs: number;
  endMs: number;
}> = ({ startMs, endMs }) => {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const timeFmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const label = `${start.toLocaleTimeString(undefined, timeFmt)} → ${end.toLocaleTimeString(undefined, timeFmt)}`;

  return (
    <div
      style={{
        // Sit just above the DaySelector pill so the date and the time
        // range read as a paired unit at the bottom-left. DaySelector lives
        // at bottom: 16, and its collapsed pill is roughly 32px tall —
        // bottom: 56 puts this with a small gap above it.
        position: "absolute",
        bottom: 56,
        left: 16,
        zIndex: 101,
        background: "rgba(250,249,246,0.92)",
        border: "1px solid rgba(61,56,51,0.12)",
        borderRadius: 4,
        padding: "6px 12px",
        backdropFilter: "blur(6px)",
        fontFamily: "'Martian Mono', monospace",
        fontSize: 10,
        fontWeight: 500,
        color: "#4a9a8a",
        letterSpacing: "0.5px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
};

/** Stable string-ification of the filter chip list. Used for equality
 * checks across the parent-sync effects (so we don't push an array up if
 * it represents the same set) and for `key={}` props that need to remount
 * a viz when its scope changes. */
const filtersKey = (cs: FilterChip[]): string =>
  cs.map((c) => `${c.domain}|${c.path}`).join(",");

/** A player ID is `pk_` + 130 hex chars — too long for a pill or filename.
 * Show `pk_abcd…wxyz` (first 4 + last 4 of the hex portion). Identifiable
 * across runs but visually compact. */
function shortenPid(pid: string): string {
  if (!pid) return "";
  if (pid.length <= 12) return pid;
  const prefix = pid.slice(0, 7); // "pk_" + 4 hex
  const suffix = pid.slice(-4);
  return `${prefix}…${suffix}`;
}

/** Map viz registry IDs to short, human-readable labels used in saved
 * filenames. Lives next to handleCapture so it's easy to find when
 * adding a new viz to the registry. Keys must match `VisualizationDef.id`
 * in `registry.ts`. */
const VIZ_FILE_LABELS: Record<string, string> = {
  trails: "moving",
  navigation: "browsing",
  clicks: "clicking",
  typing: "typing",
  scrolling: "scrolling",
  favicons: "sites",
};

/** Compose the viz-label segment of a screenshot filename from the active
 * viz IDs. Multiple active vizs join with `+` so you can tell at a glance
 * what the capture contains. Falls back to "movement" when nothing is
 * active (which shouldn't normally happen). */
function formatVizLabel(activeVizIds: string[]): string {
  if (activeVizIds.length === 0) return "movement";
  const labels = activeVizIds
    .map((id) => VIZ_FILE_LABELS[id] ?? id)
    .filter(Boolean);
  return labels.length > 0 ? labels.join("+") : "movement";
}

/** Synth a short camera-shutter "click" so the user gets audible confirmation
 * a screenshot was taken. Two-stage burst: a high-pitched square attack for
 * the mechanical click, then a quick filtered-noise puff for the lens-cap
 * shuffle. ~180ms total. Runs through its own AudioContext so it works
 * regardless of the canvas sound-engine state. */
function playShutterSound() {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;

    // Click: short square wave attack
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = "square";
    clickOsc.frequency.setValueAtTime(2400, t0);
    clickOsc.frequency.exponentialRampToValueAtTime(800, t0 + 0.04);
    clickGain.gain.setValueAtTime(0.0001, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.005);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    clickOsc.connect(clickGain).connect(ctx.destination);
    clickOsc.start(t0);
    clickOsc.stop(t0 + 0.07);

    // Whoosh: filtered noise burst slightly after the click
    const noiseDuration = 0.12;
    const noiseBuffer = ctx.createBuffer(
      1,
      Math.floor(ctx.sampleRate * noiseDuration),
      ctx.sampleRate,
    );
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(3000, t0 + 0.06);
    filter.frequency.exponentialRampToValueAtTime(800, t0 + 0.18);
    filter.Q.value = 1.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t0 + 0.06);
    noiseGain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.08);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(t0 + 0.06);
    noise.stop(t0 + 0.06 + noiseDuration);

    // Tear down the context once the sound is done so we don't accumulate
    // suspended contexts across captures.
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch {
    /* shutter sound is non-critical — silently swallow */
  }
}

// Bumped from "internet-movement-settings" so existing stale auto-saved
// defaults stop overriding the new defaults. After this version, settings
// only persist when the user explicitly modifies a control.
const SETTINGS_STORAGE_KEY = "internet-movement-settings-v2";

const loadSettings = () => {
  const defaults = DEFAULT_SETTINGS;
  const urlOverrides = parseSettingsFromUrl();

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...defaults,
        ...parsed,
        ...urlOverrides,
        eventFilter: { ...defaults.eventFilter, ...(parsed.eventFilter || {}) },
        viewportEventFilter: {
          ...defaults.viewportEventFilter,
          ...(parsed.viewportEventFilter || {}),
        },
      };
    }
  } catch (err) {
    console.error("Failed to load settings from localStorage:", err);
  }

  return { ...defaults, ...urlOverrides };
};

interface MovementCanvasProps {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  /** Called when user requests a data refresh (e.g. double-tap R or Controls button) */
  fetchEvents: () => void;
  dayCounts?: DayCounts;
  selectedDay?: string | null;
  onSelectDay?: (day: string | null) => void;
  /** URL-scope filter chips owned by the parent. Two-way mirrored with
   * `settings.filters` so the parent can decide whether the worker fetch
   * pre-filters by domain. Empty array = no filter. */
  filters?: FilterChip[];
  onSetFilters?: (filters: FilterChip[]) => void;
  activeVisualizations: string[];
  onSetActiveVisualizations: (vizIds: string[]) => void;
  /** Initial sound-on state. The AudioContext will still start suspended
   * until the user's first gesture (browser autoplay policy). */
  defaultSoundEnabled?: boolean;
  live?: boolean;
  /** Live-stream connection status, gates the people-count readout. */
  connected?: boolean;
}

export const MovementCanvas: React.FC<MovementCanvasProps> = ({
  events,
  loading,
  error,
  fetchEvents,
  dayCounts,
  selectedDay = null,
  onSelectDay,
  filters: filtersProp,
  onSetFilters,
  activeVisualizations,
  onSetActiveVisualizations,
  defaultSoundEnabled = false,
  live = false,
  connected = false,
}) => {
  const [settings, setSettings] = useState(loadSettings());
  const [controlsVisible, setControlsVisible] = useState(false);
  const [cinematic, setCinematic] = useState<CinematicConfig | null>(() =>
    parseCinematicFromUrl(),
  );
  // Bumped by the N key to ask the cinematic camera to swap subjects now.
  const [cinematicNextSignal, setCinematicNextSignal] = useState(0);

  /** When set, only events whose timestamp falls in [start, end) are passed
   * downstream to the visualization hooks. Used by the Hotspots dev tool to
   * scope the canvas to a specific span for capturing artifacts. */
  const [selectedTimeRange, setSelectedTimeRange] = useState<
    { startMs: number; endMs: number } | null
  >(() => parseTimeRangeFromUrl() ?? null);
  // Recurring time-of-day window (minutes from local midnight), e.g. the
  // "midnight moment" — within 15 min of 00:00 across every day in the data.
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayFilter | null>(
    () => parseTimeOfDayFromUrl() ?? null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [dayPlaybackMode, setDayPlaybackMode] = useState<"cycle" | "loop">(
    "cycle",
  );
  const [soundEnabled, setSoundEnabled] = useState(defaultSoundEnabled);
  const soundEngineRef = useRef<SoundEngine | null>(null);
  // The engine is created inside an async init().then(), so we mirror it into
  // state once ready — refs alone don't trigger re-renders, which means
  // children would never receive the engine as a prop.
  const [soundEngineReady, setSoundEngineReady] = useState<SoundEngine | null>(
    null,
  );

  /** Pause/play for all the rAF-driven animations. Per-tab session state —
   * never URL-encoded, never persisted. Toggled by double-tap P or the
   * top-right pause button. The sound engine pauses alongside the visual
   * loop so audio doesn't keep ticking against a frozen canvas. */
  const [paused, setPaused] = useState(false);

  /** Demo / clean-presentation mode. Hides the sound toggle and time
   * readouts so the canvas reads as a finished art piece. URL `?clean=1`
   * sets this on load; the "save image" flow flips it on transiently
   * during capture so the rendered PNG doesn't include any UI chrome. */
  /** Clean-presentation level. URL sets the baseline; the save-image
   * flow can bump it transiently. We take the max of the two so a
   * `?clean=2` URL never gets *downgraded* mid-capture. See `CleanLevel`
   * docs in `../config.ts` for what each tier hides. */
  const cleanFromUrl = useMemo(() => parseCleanFromUrl(), []);
  const [captureCleanOverride, setCaptureCleanOverride] = useState(false);
  const cleanLevel = Math.max(
    cleanFromUrl,
    captureCleanOverride ? 1 : 0,
  ) as 0 | 1 | 2;
  const cleanMode = cleanLevel >= 1; // level 1+: hides sound + readouts
  const printMode = cleanLevel >= 2; // level 2: also hides metadata pill + DaySelector

  // Mark the document so page-level chrome (the "we were online" wordmark
  // rendered outside this component) can hide itself for a fully bare capture.
  // Hidden whenever cinematic mode is on OR clean=2 (print) is requested.
  // Cleared when neither applies / on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const bare = !!cinematic || printMode;
    document.body.classList.toggle("hide-wordmark", bare);
    return () => document.body.classList.remove("hide-wordmark");
  }, [cinematic, printMode]);

  // Sync filter chip list from prop (parent controls refetching). The
  // parent only re-fetches the events array when the worker-side domain
  // changes; that derivation lives one layer up in archive.tsx.
  useEffect(() => {
    if (filtersProp === undefined) return;
    const cur: FilterChip[] = Array.isArray(settings.filters)
      ? settings.filters
      : [];
    if (filtersKey(filtersProp) !== filtersKey(cur)) {
      setSettings((s: any) => ({ ...s, filters: filtersProp }));
    }
  }, [filtersProp]);

  // Notify parent when the chip list changes. Same loop guard as before —
  // only push up when prop and state actually disagree, otherwise the
  // mount handoff between localStorage-hydrated settings and an empty
  // prop pings back and forth forever.
  useEffect(() => {
    if (filtersProp === undefined) return;
    const cur: FilterChip[] = Array.isArray(settings.filters)
      ? settings.filters
      : [];
    if (filtersKey(filtersProp) !== filtersKey(cur)) {
      onSetFilters?.(cur);
    }
  }, [settings.filters]);

  // Manage SoundEngine lifecycle
  useEffect(() => {
    if (soundEnabled) {
      if (!soundEngineRef.current) {
        const engine = new SoundEngine();
        engine.init().then(() => {
          engine.setCanvasWidth(viewportSize.width);
          engine.setConfig({
            chordVoicing: settings.soundChordVoicing,
            cursorInstruments: settings.soundCursorInstruments,
            crossingDissonance: settings.soundCrossingDissonance,
          });
          soundEngineRef.current = engine;
          setSoundEngineReady(engine);
        });
      }
    } else {
      if (soundEngineRef.current) {
        soundEngineRef.current.dispose();
        soundEngineRef.current = null;
        setSoundEngineReady(null);
      }
    }
    return () => {
      soundEngineRef.current?.dispose();
      soundEngineRef.current = null;
      setSoundEngineReady(null);
    };
  }, [soundEnabled]);

  useEffect(() => {
    soundEngineRef.current?.setCanvasWidth(viewportSize.width);
  }, [viewportSize.width]);

  // Sync sound config settings to the engine
  useEffect(() => {
    soundEngineRef.current?.setConfig({
      chordVoicing: settings.soundChordVoicing,
      cursorInstruments: settings.soundCursorInstruments,
      crossingDissonance: settings.soundCrossingDissonance,
    });
  }, [
    settings.soundChordVoicing,
    settings.soundCursorInstruments,
    settings.soundCrossingDissonance,
  ]);

  // Derive which visualization categories are active
  const vizSet = useMemo(
    () => new Set(activeVisualizations),
    [activeVisualizations],
  );
  const showTrails = vizSet.has("trails");
  const showClicks = vizSet.has("clicks");
  const hasCursorViz = showTrails || showClicks;
  const showTyping = vizSet.has("typing");
  const showScrolling = vizSet.has("scrolling");
  const showNavigation = vizSet.has("navigation");
  const showFavicons = vizSet.has("favicons");

  const handleTogglePlaybackMode = useCallback(() => {
    setDayPlaybackMode((m) => (m === "cycle" ? "loop" : "cycle"));
  }, []);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      if (next) {
        // Resume an existing engine's AudioContext from within the gesture so
        // sound starts immediately. First-time init() handles its own resume.
        soundEngineRef.current?.resume();
      }
      return next;
    });
  }, []);

  const handleCapture = useCallback(async () => {
    if (!containerRef.current) return;
    // Toggle clean mode for the duration of the capture so the saved PNG
    // doesn't bake in the sound button or time readouts. Wait two rAFs
    // after the state flip so React commits the render before html2canvas
    // serializes the DOM.
    setCaptureCleanOverride(true);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(containerRef.current, {
        backgroundColor: "#faf9f6",
        scale: 2,
      });
      const link = document.createElement("a");
      const vizLabel = formatVizLabel(activeVisualizations);
      link.download = `[INT-MV] ${vizLabel}-${selectedDay ?? "all"}-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      playShutterSound();
    } finally {
      setCaptureCleanOverride(false);
    }
  }, [selectedDay, activeVisualizations]);

  // The URL is now the source of truth for the current configuration — any
  // change to settings, viz selection, or the canvas time range is mirrored
  // into the address bar via `history.replaceState` (see effect below).
  // Refresh re-parses the URL, so reloading never loses what you were doing.
  // localStorage is still used, but only as the first-visit baseline for
  // people who haven't shared/saved a URL — see "Save as default" in the
  // dev panel for the explicit LS write path.
  const setSettingsFromControls = setSettings;

  // Debounce the URL rewrite so dragging a slider doesn't thrash the
  // history entry. `replaceState` is cheap, but skipping calls until input
  // settles keeps the URL bar visually quiet during interaction.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        const next = buildShareUrl({
          settings,
          activeVisualizations,
          selectedTimeRange,
          clean: parseCleanFromUrl(),
        });
        // Only call replaceState when the URL actually changes. Avoids
        // browser-level history-entry churn (some engines coalesce, some
        // don't) and keeps the DevTools Network tab quiet.
        if (next !== window.location.href) {
          window.history.replaceState(null, "", next);
        }
      } catch (err) {
        console.error("Failed to sync URL with settings:", err);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [settings, activeVisualizations, selectedTimeRange]);

  // Keyboard shortcuts:
  //   double-tap D — toggle controls panel
  //   double-tap R — reload data
  //   double-tap P — pause / resume all animations
  //   Cmd/Ctrl+Shift+S — save PNG screenshot in clean UI mode
  useEffect(() => {
    let lastDKeyTime = 0;
    let lastRKeyTime = 0;
    let lastPKeyTime = 0;
    const DOUBLE_TAP_THRESHOLD = 300;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Skip when the user is typing into an input — otherwise double-tap
      // shortcuts would fire while filling out the filter inputs.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }

      // Cmd/Ctrl+Shift+S → screenshot. Check this first so the modifier
      // combo never falls through to the bare-S double-tap family below.
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "s" || e.key === "S")
      ) {
        e.preventDefault();
        handleCapture();
        return;
      }

      // Shift+C → toggle cinematic (cursor-follow) mode.
      if (e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        setCinematic((prev) =>
          prev ? null : parseCinematicFromUrl() ?? DEFAULT_CINEMATIC_CONFIG,
        );
        return;
      }

      // N → swap the cinematic camera to a new cursor immediately.
      if (e.key === "n" || e.key === "N") {
        setCinematicNextSignal((n) => n + 1);
        return;
      }

      // Mode switches (stubs for hand-choreographing later).
      // 3 = cursor-follow (only one implemented). 1 = wide, 2 = activity.
      if (e.key === "1" || e.key === "2") {
        console.info(`[cinematic] mode ${e.key} not yet implemented`);
        return;
      }
      if (e.key === "3") {
        setCinematic(
          (prev) => prev ?? parseCinematicFromUrl() ?? DEFAULT_CINEMATIC_CONFIG,
        );
        return;
      }

      const now = Date.now();
      if (e.key === "d" || e.key === "D") {
        if (now - lastDKeyTime < DOUBLE_TAP_THRESHOLD) {
          setControlsVisible((prev) => !prev);
          lastDKeyTime = 0;
        } else {
          lastDKeyTime = now;
        }
      } else if (e.key === "r" || e.key === "R") {
        if (now - lastRKeyTime < DOUBLE_TAP_THRESHOLD) {
          fetchEvents();
          lastRKeyTime = 0;
        } else {
          lastRKeyTime = now;
        }
      } else if (e.key === "p" || e.key === "P") {
        if (now - lastPKeyTime < DOUBLE_TAP_THRESHOLD) {
          setPaused((prev) => !prev);
          lastPKeyTime = 0;
        } else {
          lastPKeyTime = now;
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [fetchEvents, handleCapture]);

  // Expose a `window.__movementReady` promise that resolves once data has
  // loaded and the first animation frame has rendered. Used by the
  // capture-matrix script to know when to start recording so every clip
  // begins from a comparable starting state. No-op in production usage —
  // it just sits on the window object.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    if (events.length === 0) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        (window as unknown as { __movementReady?: boolean }).__movementReady =
          true;
        window.dispatchEvent(new CustomEvent("movement:ready"));
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [loading, events.length]);

  // Track canvas size via ResizeObserver
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setViewportSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(containerRef.current);
    } else {
      window.addEventListener("resize", updateSize);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", updateSize);
      }
    };
  }, []);

  // Compute available domains for filter dropdown
  const availableDomains = useMemo(() => {
    const domains = new Set<string>();
    events.forEach((event) => {
      const domain = extractDomain(event.meta.url || "");
      if (domain) domains.add(domain);
    });
    return Array.from(domains).sort();
  }, [events]);

  // Drop any chips whose domain isn't in `availableDomains` anymore.
  // Bare-path chips (no domain) survive — they're domain-agnostic.
  useEffect(() => {
    if (events.length === 0 || availableDomains.length === 0) return;
    const cur: FilterChip[] = Array.isArray(settings.filters)
      ? settings.filters
      : [];
    if (cur.length === 0) return;
    const allowed = new Set(availableDomains);
    const next = cur.filter((c) => !c.domain || allowed.has(c.domain));
    if (next.length !== cur.length) {
      setSettings((s: any) => ({ ...s, filters: next }));
    }
  }, [events.length]);

  // ── Event processing hooks ──────────────────────────────────────────────────

  // Apply the dev-tool time-range filter before any visualization hook sees
  // the data. Hooks already pay attention to event identity, so memoizing is
  // important — when no range is active we just pass the events array
  // through untouched.
  const filteredEvents = useMemo(() => {
    if (!selectedTimeRange && !timeOfDay) return events;

    // Recurring time-of-day test: how far (in minutes, shortest way around the
    // 24h clock) is an event's LOCAL time-of-day from the window center? Uses
    // the viewer's local timezone via Date#getHours/getMinutes. Wraparound
    // matters: a midnight window (center 0) must match both 23:50 and 00:10.
    const todTest = timeOfDay
      ? (ts: number) => {
          const d = new Date(ts);
          const minutesOfDay = d.getHours() * 60 + d.getMinutes();
          let diff = Math.abs(minutesOfDay - timeOfDay.centerMinutes);
          if (diff > 720) diff = 1440 - diff; // shortest distance around the clock
          return diff <= timeOfDay.radiusMinutes;
        }
      : null;

    return events.filter((e) => {
      if (selectedTimeRange) {
        if (e.ts < selectedTimeRange.startMs || e.ts >= selectedTimeRange.endMs)
          return false;
      }
      if (todTest && !todTest(e.ts)) return false;
      return true;
    });
  }, [events, selectedTimeRange, timeOfDay]);

  // In live mode, accumulate each trail's full point history so trails don't
  // shrink/shift/vanish as their earliest events age off the stream cap. The
  // archive's event set is fixed, so it bypasses accumulation. A group's events
  // are freed when its trail has fully faded out (LiveTrails reports the id).
  const evictIdsRef = useRef<Set<string>>(new Set());
  const handleTrailsRemoved = useCallback((ids: string[]) => {
    for (const id of ids) evictIdsRef.current.add(id);
  }, []);
  const trailEvents = useAccumulatedEvents(filteredEvents, {
    enabled: live,
    maxGroups: 60,
    evictIdsRef,
  });
  const activeTrailEvents = hasCursorViz ? trailEvents : EMPTY_EVENTS;
  const activeTypingEvents = showTyping ? filteredEvents : EMPTY_EVENTS;
  const activeScrollingEvents = showScrolling ? filteredEvents : EMPTY_EVENTS;
  const activeNavigationEvents = showNavigation ? filteredEvents : EMPTY_EVENTS;

  const cursorSettings = useMemo(
    () => ({
      randomizeColors: settings.randomizeColors,
      filters: (settings.filters as FilterChip[] | undefined) ?? [],
      pidFilter: settings.pidFilter,
      eventFilter: settings.eventFilter,
      trailStyle: settings.trailStyle,
      chaosIntensity: settings.chaosIntensity,
      trailAnimationMode: live ? "natural" : settings.trailAnimationMode,
      maxConcurrentTrails: settings.maxConcurrentTrails,
      overlapFactor: settings.overlapFactor,
      minGapBetweenTrails: settings.minGapBetweenTrails,
      documentSpace: settings.documentSpace,
      // Live mode collapses each participant+url to one trail so ids stay
      // unique/stable as the event window slides (the archive shows every
      // segment). Prevents duplicate React keys and disappearing trails.
      singleSegmentPerGroup: live,
    }),
    [
      settings.randomizeColors,
      settings.filters,
      settings.pidFilter,
      settings.eventFilter,
      settings.trailStyle,
      settings.chaosIntensity,
      settings.trailAnimationMode,
      live,
      settings.maxConcurrentTrails,
      settings.overlapFactor,
      settings.minGapBetweenTrails,
      settings.documentSpace,
    ],
  );

  const {
    trails,
    trailStates,
    timeBounds: cursorTimeBounds,
    cycleDuration: cursorCycleDuration,
  } = useCursorTrails(activeTrailEvents, viewportSize, cursorSettings);

  // Recent activity (live mode) from the raw event stream, not the capped drawn
  // trails: how many people + the geographic spread of their timezones.
  const activity = useMemo(() => summarizeActiveLocations(events), [events]);

  // The keyboard hook is invoked here (before timeRange) because its
  // cycleDuration feeds the canvas's shared animation cycle. Without this,
  // a typing-only configuration would loop at cursorCycleDuration (0 →
  // fallback 60s), forcing the schedule's `% cycleDuration` to wrap many
  // sessions onto the same offsets.
  const keyboardSettings = useMemo(
    () => ({
      filters: (settings.filters as FilterChip[] | undefined) ?? [],
      pidFilter: settings.pidFilter,
      keyboardOverlapFactor: settings.keyboardOverlapFactor,
      keyboardMinFontSize: settings.keyboardMinFontSize,
      keyboardMaxFontSize: settings.keyboardMaxFontSize,
      keyboardPositionRandomness: settings.keyboardPositionRandomness,
      keyboardRandomizeOrder: settings.keyboardRandomizeOrder,
      maxConcurrentTyping: settings.maxConcurrentTyping,
      keyboardSizeCap: settings.keyboardSizeCap,
    }),
    [
      settings.filters,
      settings.pidFilter,
      settings.keyboardOverlapFactor,
      settings.keyboardMinFontSize,
      settings.keyboardMaxFontSize,
      settings.keyboardPositionRandomness,
      settings.keyboardRandomizeOrder,
      settings.maxConcurrentTyping,
      settings.keyboardSizeCap,
    ],
  );

  const {
    typingStates,
    timeBounds: keyboardTimeBounds,
    cycleDuration: keyboardCycleDuration,
  } = useKeyboardTyping(activeTypingEvents, viewportSize, keyboardSettings);

  const timeRange = useMemo(() => {
    const allMins: number[] = [];
    const allMaxs: number[] = [];

    if (cursorTimeBounds.min > 0 || cursorTimeBounds.max > 0) {
      allMins.push(cursorTimeBounds.min);
      allMaxs.push(cursorTimeBounds.max);
    }
    if (keyboardTimeBounds.min > 0 || keyboardTimeBounds.max > 0) {
      allMins.push(keyboardTimeBounds.min);
      allMaxs.push(keyboardTimeBounds.max);
    }

    // Pick the largest cycle across active vizs so each can fit its
    // schedule without wrapping. Fall back to one minute when nothing's
    // active yet.
    const duration = Math.max(
      cursorCycleDuration,
      keyboardCycleDuration,
      60000,
    );

    if (allMins.length === 0) return { min: 0, max: 0, duration };

    return {
      min: Math.min(...allMins),
      max: Math.max(...allMaxs),
      duration,
    };
  }, [
    cursorTimeBounds,
    cursorCycleDuration,
    keyboardTimeBounds,
    keyboardCycleDuration,
  ]);

  const { scheduledClicks, clickCycleDuration } = useMemo(() => {
    if (!showClicks) {
      return { scheduledClicks: [], clickCycleDuration: 0 };
    }

    const clickColorRenderer = getTrailRenderer(
      settings.trailVisualStyle ?? "color",
    );
    const flat: ScheduledClick[] = [];
    trailStates.forEach((state, trailIndex) => {
      const { startOffsetMs, durationMs, trail, clicksWithProgress } = state;
      clicksWithProgress.forEach((click, clickIdx) => {
        const spawnAtMs = startOffsetMs + click.progress * durationMs;
        flat.push({
          id: `trail-${trailIndex}-click-${clickIdx}`,
          x: click.x,
          y: click.y,
          color: clickColorRenderer.getClickColor(trail.color),
          spawnAtMs,
          holdDuration: click.duration,
        });
      });
    });
    if (flat.length === 0)
      return { scheduledClicks: [], clickCycleDuration: 0 };

    flat.sort((a, b) => a.spawnAtMs - b.spawnAtMs);

    // Preserve the natural rhythm of the original click events. Normalize so
    // the first click fires at t=0. Optionally cap the gap between
    // consecutive clicks so dead-air sections collapse without disturbing
    // cluster rhythm — when clickMaxGapMs is set, any gap longer than the
    // cap gets clamped, but tighter spans stay verbatim.
    const maxGap: number | null =
      typeof settings.clickMaxGapMs === "number" && settings.clickMaxGapMs > 0
        ? settings.clickMaxGapMs
        : null;

    const normalized: ScheduledClick[] = [];
    let prevSrc = flat[0].spawnAtMs;
    let prevOut = 0;
    for (let i = 0; i < flat.length; i++) {
      const c = flat[i];
      if (i === 0) {
        normalized.push({ ...c, spawnAtMs: 0 });
        continue;
      }
      const naturalGap = c.spawnAtMs - prevSrc;
      const cappedGap =
        maxGap !== null ? Math.min(naturalGap, maxGap) : naturalGap;
      const out = prevOut + cappedGap;
      normalized.push({ ...c, spawnAtMs: out });
      prevSrc = c.spawnAtMs;
      prevOut = out;
    }

    const lastSpawnAtMs = normalized[normalized.length - 1].spawnAtMs;
    const avgRippleDurationMs =
      (settings.clickMinDuration + settings.clickMaxDuration) / 2;
    const clickCycleDuration = lastSpawnAtMs + avgRippleDurationMs;

    return { scheduledClicks: normalized, clickCycleDuration };
  }, [
    trailStates,
    showClicks,
    settings.clickMinDuration,
    settings.clickMaxDuration,
    settings.clickMaxGapMs,
    settings.trailVisualStyle,
  ]);

  const viewportSettings = useMemo(
    () => ({
      filters: (settings.filters as FilterChip[] | undefined) ?? [],
      pidFilter: settings.pidFilter,
      viewportEventFilter: settings.viewportEventFilter,
    }),
    [settings.filters, settings.pidFilter, settings.viewportEventFilter],
  );

  const { animations: scrollAnimations, urlMetadata: scrollUrlMetadata } =
    useViewportScroll(activeScrollingEvents, viewportSize, viewportSettings);

  // For viewports whose URL has no captured title (no navigation event), ask
  // the worker's /page-meta endpoint to resolve title + favicon live (oEmbed
  // for known providers, HTML scrape otherwise). Module-cached, so a given
  // URL is fetched at most once per page lifetime.
  const scrollUrls = useMemo(
    () => scrollAnimations.map((a) => a.pageUrl).filter(Boolean),
    [scrollAnimations],
  );
  const resolvedScrollMetadata = usePageMetaFallback(
    scrollUrls,
    scrollUrlMetadata,
  );

  const navigationTimelineSettings = useMemo(
    () => ({
      filters: (settings.filters as FilterChip[] | undefined) ?? [],
      pidFilter: settings.pidFilter,
      maxSessions: settings.navigationMaxSessions,
      minSessionEvents: settings.navigationMinSessionEvents,
      canvasWidth: viewportSize.width,
      canvasHeight: viewportSize.height,
    }),
    [
      settings.filters,
      settings.pidFilter,
      settings.navigationMaxSessions,
      settings.navigationMinSessionEvents,
      viewportSize.width,
      viewportSize.height,
    ],
  );

  const { timelineState } = useNavigationTimeline(
    activeNavigationEvents,
    navigationTimelineSettings,
  );

  const navigationRadialSettings = useMemo(
    () => ({
      filters: (settings.filters as FilterChip[] | undefined) ?? [],
      pidFilter: settings.pidFilter,
      maxSessions: settings.navigationMaxSessions,
      minSessionEvents: settings.navigationMinSessionEvents,
      canvasWidth: viewportSize.width,
      canvasHeight: viewportSize.height,
      segmentByDay: settings.navigationRadialSegmentByDay ?? true,
    }),
    [
      settings.filters,
      settings.pidFilter,
      settings.navigationMaxSessions,
      settings.navigationMinSessionEvents,
      settings.navigationRadialSegmentByDay,
      viewportSize.width,
      viewportSize.height,
    ],
  );

  const { radialState } = useNavigationRadial(
    activeNavigationEvents,
    navigationRadialSettings,
  );

  const typingSettings = useMemo(
    () => ({
      animationSpeed: settings.animationSpeed,
      textboxOpacity: settings.textboxOpacity,
      keyboardShowCaret: settings.keyboardShowCaret,
      keyboardAnimationSpeed: settings.keyboardAnimationSpeed,
      keyboardLegibilityPct: settings.keyboardLegibilityPct,
      maxConcurrentTyping: settings.maxConcurrentTyping,
    }),
    [
      settings.animationSpeed,
      settings.textboxOpacity,
      settings.keyboardShowCaret,
      settings.keyboardAnimationSpeed,
      settings.keyboardLegibilityPct,
      settings.maxConcurrentTyping,
    ],
  );

  const scrollSettings = useMemo(
    () => ({
      scrollSpeed: settings.scrollSpeed,
      backgroundOpacity: settings.backgroundOpacity,
      maxConcurrentScrolls: settings.maxConcurrentScrolls,
      randomizeColors: settings.randomizeColors,
      showPagePreview: settings.showPagePreview,
      allowOverlap: settings.allowOverlap,
      showScrollEvents: settings.showScrollEvents,
      showResizeEvents: settings.showResizeEvents,
      showZoomEvents: settings.showZoomEvents,
      windowScale: settings.windowScale,
      windowBleed: settings.windowBleed,
      showTitleBar: settings.showTitleBar,
    }),
    [
      settings.scrollSpeed,
      settings.backgroundOpacity,
      settings.maxConcurrentScrolls,
      settings.randomizeColors,
      settings.showPagePreview,
      settings.allowOverlap,
      settings.showScrollEvents,
      settings.showResizeEvents,
      settings.showZoomEvents,
      settings.windowScale,
      settings.windowBleed,
      settings.showTitleBar,
    ],
  );

  const navigationSettings = useMemo(
    () => ({
      scrollSpeed: settings.navigationScrollSpeed,
      nodeOpacity: settings.navigationWindowOpacity,
      edgeOpacity: settings.navigationEdgeOpacity,
      randomizeColors: settings.randomizeColors,
    }),
    [
      settings.navigationScrollSpeed,
      settings.navigationWindowOpacity,
      settings.navigationEdgeOpacity,
      settings.randomizeColors,
    ],
  );

  const trailAnimationSettings = useMemo(
    () => ({
      strokeWidth: settings.strokeWidth,
      trailOpacity: settings.trailOpacity,
      animationSpeed: settings.animationSpeed,
      clickMinRadius: settings.clickMinRadius,
      clickMaxRadius: settings.clickMaxRadius,
      clickCoreRadius: settings.clickCoreRadius,
      clickMinDuration: settings.clickMinDuration,
      clickMaxDuration: settings.clickMaxDuration,
      clickExpansionDuration: settings.clickExpansionDuration,
      clickStrokeWidth: settings.clickStrokeWidth,
      clickOpacity: settings.clickOpacity,
      clickNumRings: settings.clickNumRings,
      clickRingDelayMs: settings.clickRingDelayMs,
      clickAnimationStopPoint: settings.clickAnimationStopPoint,
      trailVisualStyle: settings.trailVisualStyle,
    }),
    [
      settings.strokeWidth,
      settings.trailOpacity,
      settings.animationSpeed,
      settings.clickMinRadius,
      settings.clickMaxRadius,
      settings.clickCoreRadius,
      settings.clickMinDuration,
      settings.clickMaxDuration,
      settings.clickExpansionDuration,
      settings.clickStrokeWidth,
      settings.clickOpacity,
      settings.clickNumRings,
      settings.clickRingDelayMs,
      settings.clickAnimationStopPoint,
      settings.trailVisualStyle,
    ],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <DebugHoverProvider enabled={!!settings.debugMode}>
    <div className="internet-movement">
      <Controls
        visible={controlsVisible}
        settings={settings}
        setSettings={setSettingsFromControls}
        loading={loading}
        error={error}
        events={events}
        filteredEventCount={filteredEvents.length}
        trails={trails}
        availableDomains={availableDomains}
        fetchEvents={fetchEvents}
        timeRange={timeRange}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={onSetActiveVisualizations}
        selectedTimeRange={selectedTimeRange}
        onSelectTimeRange={setSelectedTimeRange}
      />

      {/* Top-of-screen stats console. Paired with the bottom ActivityStrip
          (same gating + leftOffset math) so the dev surface has a
          symmetrical "instrument frame" around the canvas. */}
      {controlsVisible && events.length > 0 && (
        <StatsConsole
          events={events}
          filteredEventCount={filteredEvents.length}
          trailCount={trails.length}
          cycleDurationMs={timeRange.duration}
          animationSpeed={settings.animationSpeed}
          leftOffset={controlsVisible ? 340 : 16}
          loading={loading}
          error={error}
        />
      )}

      {!printMode &&
        ((settings.filters as FilterChip[] | undefined)?.length || settings.pidFilter) && (
          <div
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              zIndex: 100,
              maxWidth: 360,
            }}
          >
            <div
              style={{
                position: "relative",
                padding: "10px 16px",
                background: "#faf9f6",
                border: "1px solid rgba(0, 0, 0, 0.12)",
                boxShadow:
                  "inset 1px 1px 2px rgba(255, 255, 255, 0.8), inset -1px -1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)",
                fontFamily:
                  '"Martian Mono", "Space Mono", "Courier New", monospace',
                fontSize: "11px",
                fontWeight: "600",
                color: "#333",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                overflow: "hidden",
              }}
            >
              <svg
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0.15,
                  pointerEvents: "none",
                }}
              >
                <filter id="domainNoise">
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.9"
                    numOctaves="4"
                  />
                  <feColorMatrix type="saturate" values="0" />
                  <feComponentTransfer>
                    <feFuncA type="discrete" tableValues="0 0.3 0.5 0.7" />
                  </feComponentTransfer>
                </filter>
                <rect width="100%" height="100%" filter="url(#domainNoise)" />
              </svg>
              <span
                style={{
                  position: "relative",
                  zIndex: 1,
                  display: "inline-block",
                  wordBreak: "break-all",
                }}
              >
                {((settings.filters as FilterChip[] | undefined) ?? [])
                  .map((c) => formatFilterChip(c) || "*")
                  .join(" | ")}
                {settings.pidFilter
                  ? `${(settings.filters as FilterChip[] | undefined)?.length ? " ~ " : "~"}${shortenPid(settings.pidFilter)}`
                  : ""}
              </span>
            </div>
          </div>
        )}

      {!cleanMode && (selectedTimeRange ? (
        <SelectedRangeReadout
          startMs={selectedTimeRange.startMs}
          endMs={selectedTimeRange.endMs}
        />
      ) : (
        // The live page shows current "now" via the WordmarkClock instead — this
        // readout sweeps/loops the buffer's time span, which only makes sense for
        // the archive (scrubbing through historical time).
        !live &&
        settings.trailAnimationMode === "natural" &&
        showTrails &&
        timeRange.min > 0 &&
        timeRange.duration > 0 && (
          <NaturalTimeReadout
            startTimestampMs={timeRange.min}
            durationMs={timeRange.duration}
            animationSpeed={settings.animationSpeed}
          />
        )
      ))}

      {/* Live people-count, bottom-left. Same plain look as the homepage. */}
      {!cleanMode && live && (
        <LiveIndicator
          connected={connected}
          peopleCount={activity.people}
          timezones={activity.timezones}
          continents={activity.continents}
          style={{ position: "absolute", bottom: 20, left: 20, zIndex: 100 }}
        />
      )}

      {/* Only surface the pause/resume control while paused — when the
       * canvas is animating, the button adds visual noise without
       * carrying useful info. Double-tap P always works regardless. */}
      {!cleanMode && paused && (
        <button
          onClick={() => setPaused(false)}
          title="Resume animations (P P)"
          style={{
            position: "absolute",
            top: 14,
            right: 52,
            zIndex: 200,
            padding: 6,
            background: "none",
            border: "none",
            cursor: "pointer",
            opacity: 0.9,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="#3d3833"
          >
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        </button>
      )}

      {!cleanMode && (
      <button
        onClick={handleToggleSound}
        title={soundEnabled ? "Mute" : "Play sound"}
        style={{
          position: "absolute",
          top: 14,
          right: 20,
          zIndex: 200,
          padding: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          opacity: soundEnabled ? 0.7 : 0.3,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3d3833"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          {soundEnabled ? (
            <>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </>
          ) : (
            <>
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </>
          )}
        </svg>
      </button>
      )}

      <div className="canvas-container" ref={containerRef}>
        {/* RISO paper texture overlay */}
        <svg
          width="100%"
          height="100%"
          className="riso-pattern"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.7,
            pointerEvents: "none",
            mixBlendMode: "multiply",
          }}
        >
          <defs>
            <filter id="noise">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="3"
                stitchTiles="stitch"
              />
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
              />
            </filter>
            <filter id="grain">
              <feTurbulence
                type="turbulence"
                baseFrequency="0.5"
                numOctaves="2"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
              </feComponentTransfer>
            </filter>
            <filter id="smoothing">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" />
            </filter>
          </defs>
          <rect width="100%" height="100%" filter="url(#noise)" />
          <rect
            width="100%"
            height="100%"
            filter="url(#grain)"
            style={{ opacity: 0.3 }}
          />
        </svg>

        {showTrails &&
          (live ? (
            <LiveTrails
              key={`live-trails-${filtersKey((settings.filters as FilterChip[] | undefined) ?? [])}`}
              trailStates={trailStates}
              frozen={paused}
              onTrailsRemoved={handleTrailsRemoved}
              settings={trailAnimationSettings}
            />
          ) : (
            <AnimatedTrails
              key={`trails-${filtersKey((settings.filters as FilterChip[] | undefined) ?? [])}`}
              trailStates={trailStates}
              timeRange={timeRange}
              showClickRipples={!showClicks}
              windowSize={settings.maxConcurrentTrails * 2}
              soundEngine={paused || !soundEnabled ? null : soundEngineReady}
              settings={trailAnimationSettings}
              frozen={paused}
              cinematic={cinematic}
              cinematicNextSignal={cinematicNextSignal}
            />
          ))}

        {showClicks && !paused && (
          <AnimatedClicks
            key={`clicks-${filtersKey((settings.filters as FilterChip[] | undefined) ?? [])}`}
            scheduledClicks={scheduledClicks}
            timeRange={{ duration: clickCycleDuration }}
            soundEngine={soundEnabled ? soundEngineReady : null}
            settings={{
              animationSpeed: settings.animationSpeed,
              clickMinRadius: settings.clickMinRadius,
              clickMaxRadius: settings.clickMaxRadius,
              clickCoreRadius: settings.clickCoreRadius,
              clickMinDuration: settings.clickMinDuration,
              clickMaxDuration: settings.clickMaxDuration,
              clickExpansionDuration: settings.clickExpansionDuration,
              clickStrokeWidth: settings.clickStrokeWidth,
              clickOpacity: settings.clickOpacity,
              clickNumRings: settings.clickNumRings,
              clickRingDelayMs: settings.clickRingDelayMs,
              clickAnimationStopPoint: settings.clickAnimationStopPoint,
            }}
          />
        )}

        {showTyping && !paused && (
          <AnimatedTyping
            typingStates={typingStates}
            timeRange={timeRange}
            settings={typingSettings}
          />
        )}

        {showScrolling && !paused && scrollAnimations && scrollAnimations.length > 0 && (
          <AnimatedScrollViewports
            animations={scrollAnimations}
            canvasSize={viewportSize}
            settings={scrollSettings}
            urlMetadata={resolvedScrollMetadata}
          />
        )}

        {showNavigation &&
          !paused &&
          (settings.navigationViewMode ?? "timeline") === "radial" &&
          radialState &&
          radialState.nodes.size > 0 && (
            <AnimatedNavigationRadial
              radialState={radialState}
              canvasSize={viewportSize}
              settings={{
                nodeOpacity: settings.navigationWindowOpacity,
                edgeOpacity: settings.navigationEdgeOpacity,
                maxParallelEdges: settings.navigationMaxParallelEdges,
                segmentByDay: settings.navigationRadialSegmentByDay ?? true,
                playbackMode: selectedDay ? dayPlaybackMode : "cycle",
                blob: {
                  samples: settings.navigationRadialBlobSamples,
                  curveTension: settings.navigationRadialBlobCurveTension,
                  edgeNoise: settings.navigationRadialBlobEdgeNoise,
                  valleyDepth: settings.navigationRadialBlobValleyDepth,
                },
              }}
            />
          )}

        {showNavigation &&
          !paused &&
          (settings.navigationViewMode ?? "timeline") === "timeline" &&
          timelineState &&
          timelineState.nodes.size > 0 && (
            <AnimatedNavigation
              timelineState={timelineState}
              canvasSize={viewportSize}
              settings={navigationSettings}
            />
          )}

        {showFavicons && (
          <FaviconPortrait
            events={filteredEvents}
            // FaviconPortrait is single-domain by design — surface the
            // first chip's domain (if any) so a bare `?filter=site.com`
            // still scopes the favicon grid.
            domainFilter={
              ((settings.filters as FilterChip[] | undefined) ?? [])[0]
                ?.domain ?? ""
            }
          />
        )}
      </div>

      {controlsVisible && (events.length > 0 || (dayCounts && dayCounts.size > 0)) && (
        <ActivityStrip
          events={events}
          dayCounts={dayCounts}
          selectedDay={selectedDay}
          onSelectDay={onSelectDay}
          selectedRange={selectedTimeRange}
          onSelectRange={setSelectedTimeRange}
          leftOffset={controlsVisible ? 360 : 16}
        />
      )}

      {!printMode && dayCounts && onSelectDay && (
        <DaySelector
          dayCounts={dayCounts}
          selectedDay={selectedDay}
          onSelectDay={onSelectDay}
          playbackMode={dayPlaybackMode}
          onTogglePlaybackMode={handleTogglePlaybackMode}
          onCapture={handleCapture}
        />
      )}
    </div>
    </DebugHoverProvider>
  );
};
