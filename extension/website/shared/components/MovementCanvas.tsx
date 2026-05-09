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
import { SoundEngine } from "../sound/SoundEngine";
import { AnimatedClicks, type ScheduledClick } from "./AnimatedClicks";
import { AnimatedTyping } from "./AnimatedTyping";
import { AnimatedScrollViewports } from "./AnimatedScrollViewports";
import { AnimatedNavigation } from "./AnimatedNavigation";
import { AnimatedNavigationRadial } from "./AnimatedNavigationRadial";
import { FaviconPortrait } from "./FaviconPortrait";
import { DaySelector } from "./DaySelector";
import { ActivityStrip } from "./ActivityStrip";
import { useCursorTrails } from "../hooks/useCursorTrails";
import { useKeyboardTyping } from "../hooks/useKeyboardTyping";
import { useViewportScroll } from "../hooks/useViewportScroll";
import { useNavigationTimeline } from "../hooks/useNavigationTimeline";
import { useNavigationRadial } from "../hooks/useNavigationRadial";
import { extractDomain } from "../utils/eventUtils";
import { getTrailRenderer } from "../styles/trailRenderers";
import { parseSettingsFromUrl } from "../config";
import type { DayCounts } from "../types";
import { CLICK_DEFAULTS } from "./clickDefaults";

export { CLICK_DEFAULTS } from "./clickDefaults";

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
 * when a hotspot has scoped the canvas. Same visual frame as
 * NaturalTimeReadout so it slots into the existing top-center spot. */
const SelectedRangeReadout: React.FC<{
  startMs: number;
  endMs: number;
  onClear: () => void;
}> = ({ startMs, endMs, onClear }) => {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const sameDay = start.toDateString() === end.toDateString();
  const dateFmt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const timeFmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const label = sameDay
    ? `${start.toLocaleDateString(undefined, dateFmt)} ${start.toLocaleTimeString(undefined, timeFmt)} → ${end.toLocaleTimeString(undefined, timeFmt)}`
    : `${start.toLocaleDateString(undefined, dateFmt)} ${start.toLocaleTimeString(undefined, timeFmt)} → ${end.toLocaleDateString(undefined, dateFmt)} ${end.toLocaleTimeString(undefined, timeFmt)}`;

  return (
    <button
      type="button"
      onClick={onClear}
      title="Click to clear time range"
      style={{
        ...READOUT_WRAPPER_STYLE,
        cursor: "pointer",
        borderColor: "rgba(196,114,78,0.55)",
      }}
    >
      <ReadoutNoise id="rangeReadoutNoise" />
      <span style={{ position: "relative", zIndex: 1 }}>{label}</span>
    </button>
  );
};

// Bumped from "internet-movement-settings" so existing stale auto-saved
// defaults stop overriding the new defaults. After this version, settings
// only persist when the user explicitly modifies a control.
const SETTINGS_STORAGE_KEY = "internet-movement-settings-v2";

const loadSettings = () => {
  const defaults = {
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
    domainFilter: "",
    documentSpace: false,
    scrollSpeed: 1.0,
    backgroundOpacity: 0.7,
    maxConcurrentScrolls: 5,
    showPagePreview: false,
    allowOverlap: false,
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
    keyboardDisplayMode: "full" as "full" | "abstract",
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
  };

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
  domainFilter?: string;
  onSetDomainFilter?: (domain: string) => void;
  activeVisualizations: string[];
  onSetActiveVisualizations: (vizIds: string[]) => void;
  /** Initial sound-on state. The AudioContext will still start suspended
   * until the user's first gesture (browser autoplay policy). */
  defaultSoundEnabled?: boolean;
}

export const MovementCanvas: React.FC<MovementCanvasProps> = ({
  events,
  loading,
  error,
  fetchEvents,
  dayCounts,
  selectedDay = null,
  onSelectDay,
  domainFilter: domainFilterProp,
  onSetDomainFilter,
  activeVisualizations,
  onSetActiveVisualizations,
  defaultSoundEnabled = false,
}) => {
  const [settings, setSettings] = useState(loadSettings());
  const [controlsVisible, setControlsVisible] = useState(false);
  /** When set, only events whose timestamp falls in [start, end) are passed
   * downstream to the visualization hooks. Used by the Hotspots dev tool to
   * scope the canvas to a specific span for capturing artifacts. */
  const [selectedTimeRange, setSelectedTimeRange] = useState<
    { startMs: number; endMs: number } | null
  >(null);
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

  // Sync domain filter from prop (parent controls refetching)
  useEffect(() => {
    if (
      domainFilterProp !== undefined &&
      domainFilterProp !== settings.domainFilter
    ) {
      setSettings((s) => ({ ...s, domainFilter: domainFilterProp }));
    }
  }, [domainFilterProp]);

  // Notify parent when internal domain filter changes so it can refetch
  useEffect(() => {
    onSetDomainFilter?.(settings.domainFilter);
  }, [settings.domainFilter]);

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
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(containerRef.current, {
      backgroundColor: "#faf9f6",
      scale: 2,
    });
    const link = document.createElement("a");
    link.download = `movement-${selectedDay ?? "all"}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [selectedDay]);

  // Only persist settings to localStorage AFTER the user has deliberately
  // modified them via the Controls panel. We don't want first-load defaults
  // (or auto-applied changes like domain filter sync) to bake in stale
  // values that override future default tweaks.
  const userTouchedSettingsRef = useRef(false);
  const setSettingsFromControls = useCallback<typeof setSettings>(
    (update) => {
      userTouchedSettingsRef.current = true;
      setSettings(update);
    },
    [setSettings],
  );

  useEffect(() => {
    if (!userTouchedSettingsRef.current) return;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error("Failed to save settings to localStorage:", err);
    }
  }, [settings]);

  // Keyboard shortcuts: double-tap D to toggle controls, double-tap R to reload
  useEffect(() => {
    let lastDKeyTime = 0;
    let lastRKeyTime = 0;
    const DOUBLE_TAP_THRESHOLD = 300;

    const handleKeyPress = (e: KeyboardEvent) => {
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
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [fetchEvents]);

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

  // Clear domain filter if it's no longer present in available domains
  useEffect(() => {
    if (
      events.length > 0 &&
      settings.domainFilter &&
      availableDomains.length > 0 &&
      !availableDomains.includes(settings.domainFilter)
    ) {
      setSettings((s: ReturnType<typeof loadSettings>) => ({
        ...s,
        domainFilter: "",
      }));
    }
  }, [events.length]);

  // ── Event processing hooks ──────────────────────────────────────────────────

  // Apply the dev-tool time-range filter before any visualization hook sees
  // the data. Hooks already pay attention to event identity, so memoizing is
  // important — when no range is active we just pass the events array
  // through untouched.
  const filteredEvents = useMemo(() => {
    if (!selectedTimeRange) return events;
    const { startMs, endMs } = selectedTimeRange;
    return events.filter((e) => e.ts >= startMs && e.ts < endMs);
  }, [events, selectedTimeRange]);

  const cursorSettings = useMemo(
    () => ({
      randomizeColors: settings.randomizeColors,
      domainFilter: settings.domainFilter,
      eventFilter: settings.eventFilter,
      trailStyle: settings.trailStyle,
      chaosIntensity: settings.chaosIntensity,
      trailAnimationMode: settings.trailAnimationMode,
      maxConcurrentTrails: settings.maxConcurrentTrails,
      overlapFactor: settings.overlapFactor,
      minGapBetweenTrails: settings.minGapBetweenTrails,
      documentSpace: settings.documentSpace,
    }),
    [
      settings.randomizeColors,
      settings.domainFilter,
      settings.eventFilter,
      settings.trailStyle,
      settings.chaosIntensity,
      settings.trailAnimationMode,
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
  } = useCursorTrails(filteredEvents, viewportSize, cursorSettings);

  const timeRange = useMemo(() => {
    const allMins: number[] = [];
    const allMaxs: number[] = [];

    if (cursorTimeBounds.min > 0 || cursorTimeBounds.max > 0) {
      allMins.push(cursorTimeBounds.min);
      allMaxs.push(cursorTimeBounds.max);
    }

    const duration = cursorCycleDuration > 0 ? cursorCycleDuration : 60000;

    if (allMins.length === 0) return { min: 0, max: 0, duration };

    return {
      min: Math.min(...allMins),
      max: Math.max(...allMaxs),
      duration,
    };
  }, [cursorTimeBounds, cursorCycleDuration]);

  const { scheduledClicks, clickCycleDuration } = useMemo(() => {
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
    settings.clickMinDuration,
    settings.clickMaxDuration,
    settings.clickMaxGapMs,
    settings.trailVisualStyle,
  ]);

  const keyboardSettings = useMemo(
    () => ({
      domainFilter: settings.domainFilter,
      keyboardOverlapFactor: settings.keyboardOverlapFactor,
      keyboardMinFontSize: settings.keyboardMinFontSize,
      keyboardMaxFontSize: settings.keyboardMaxFontSize,
      keyboardPositionRandomness: settings.keyboardPositionRandomness,
      keyboardRandomizeOrder: settings.keyboardRandomizeOrder,
    }),
    [
      settings.domainFilter,
      settings.keyboardOverlapFactor,
      settings.keyboardMinFontSize,
      settings.keyboardMaxFontSize,
      settings.keyboardPositionRandomness,
      settings.keyboardRandomizeOrder,
    ],
  );

  const { typingStates } = useKeyboardTyping(
    filteredEvents,
    viewportSize,
    keyboardSettings,
    timeRange.duration,
    timeRange.min,
  );

  const viewportSettings = useMemo(
    () => ({
      domainFilter: settings.domainFilter,
      viewportEventFilter: settings.viewportEventFilter,
    }),
    [settings.domainFilter, settings.viewportEventFilter],
  );

  const { animations: scrollAnimations } = useViewportScroll(
    filteredEvents,
    viewportSize,
    viewportSettings,
  );

  const navigationTimelineSettings = useMemo(
    () => ({
      domainFilter: settings.domainFilter,
      maxSessions: settings.navigationMaxSessions,
      minSessionEvents: settings.navigationMinSessionEvents,
      canvasWidth: viewportSize.width,
      canvasHeight: viewportSize.height,
    }),
    [
      settings.domainFilter,
      settings.navigationMaxSessions,
      settings.navigationMinSessionEvents,
      viewportSize.width,
      viewportSize.height,
    ],
  );

  const { timelineState } = useNavigationTimeline(
    filteredEvents,
    navigationTimelineSettings,
  );

  const navigationRadialSettings = useMemo(
    () => ({
      domainFilter: settings.domainFilter,
      maxSessions: settings.navigationMaxSessions,
      minSessionEvents: settings.navigationMinSessionEvents,
      canvasWidth: viewportSize.width,
      canvasHeight: viewportSize.height,
      segmentByDay: settings.navigationRadialSegmentByDay ?? true,
    }),
    [
      settings.domainFilter,
      settings.navigationMaxSessions,
      settings.navigationMinSessionEvents,
      settings.navigationRadialSegmentByDay,
      viewportSize.width,
      viewportSize.height,
    ],
  );

  const { radialState } = useNavigationRadial(
    filteredEvents,
    navigationRadialSettings,
  );

  const typingSettings = useMemo(
    () => ({
      animationSpeed: settings.animationSpeed,
      textboxOpacity: settings.textboxOpacity,
      keyboardShowCaret: settings.keyboardShowCaret,
      keyboardAnimationSpeed: settings.keyboardAnimationSpeed,
      keyboardDisplayMode: settings.keyboardDisplayMode,
    }),
    [
      settings.animationSpeed,
      settings.textboxOpacity,
      settings.keyboardShowCaret,
      settings.keyboardAnimationSpeed,
      settings.keyboardDisplayMode,
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

      {settings.domainFilter && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            right: "20px",
            zIndex: 100,
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
            <span style={{ position: "relative", zIndex: 1 }}>
              {settings.domainFilter}
            </span>
          </div>
        </div>
      )}

      {selectedTimeRange ? (
        <SelectedRangeReadout
          startMs={selectedTimeRange.startMs}
          endMs={selectedTimeRange.endMs}
          onClear={() => setSelectedTimeRange(null)}
        />
      ) : (
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
      )}

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

        {showTrails && (
          <AnimatedTrails
            key={`trails-${settings.domainFilter}`}
            trailStates={trailStates}
            timeRange={timeRange}
            showClickRipples={!showClicks}
            windowSize={settings.maxConcurrentTrails * 2}
            soundEngine={soundEnabled ? soundEngineReady : null}
            settings={trailAnimationSettings}
          />
        )}

        {showClicks && (
          <AnimatedClicks
            key={`clicks-${settings.domainFilter}`}
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

        {showTyping && (
          <AnimatedTyping
            typingStates={typingStates}
            timeRange={timeRange}
            settings={typingSettings}
          />
        )}

        {showScrolling && scrollAnimations && scrollAnimations.length > 0 && (
          <AnimatedScrollViewports
            animations={scrollAnimations}
            canvasSize={viewportSize}
            settings={scrollSettings}
          />
        )}

        {showNavigation &&
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
            domainFilter={settings.domainFilter}
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

      {dayCounts && onSelectDay && (
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
  );
};
