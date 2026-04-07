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
import { useCursorTrails } from "../hooks/useCursorTrails";
import { useKeyboardTyping } from "../hooks/useKeyboardTyping";
import { useViewportScroll } from "../hooks/useViewportScroll";
import { useNavigationTimeline } from "../hooks/useNavigationTimeline";
import { useNavigationRadial } from "../hooks/useNavigationRadial";
import { extractDomain } from "../utils/eventUtils";
import type { DayCounts } from "../types";

const SETTINGS_STORAGE_KEY = "internet-movement-settings";

const loadSettings = () => {
  const defaults = {
    trailOpacity: 0.7,
    strokeWidth: 5,
    pointSize: 4,
    animationSpeed: 1,
    trailStyle: "chaotic" as "straight" | "smooth" | "organic" | "chaotic",
    maxConcurrentTrails: 10,
    trailAnimationMode: "stagger" as "natural" | "stagger",
    trailLifetime: 1.0,
    overlapFactor: 0.5,
    randomizeColors: false,
    minGapBetweenTrails: 0.2,
    chaosIntensity: 1.0,
    clickMinRadius: 10,
    clickMaxRadius: 80,
    clickMinDuration: 500,
    clickMaxDuration: 2500,
    clickStrokeWidth: 4,
    clickOpacity: 0.3,
    clickNumRings: 2,
    clickRingDelayMs: 120,
    clickExpansionDuration: 12300,
    clickAnimationStopPoint: 0.45,
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
    scrollOverlapFactor: 0.8,
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
    monochromeMode: false,
    soundChordVoicing: false,
    soundCursorInstruments: false,
    soundCrossingDissonance: false,
  };

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...defaults,
        ...parsed,
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

  return defaults;
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
}) => {
  const [settings, setSettings] = useState(loadSettings());
  const [controlsVisible, setControlsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [dayPlaybackMode, setDayPlaybackMode] = useState<"cycle" | "loop">(
    "cycle",
  );
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEngineRef = useRef<SoundEngine | null>(null);

  // Sync domain filter from prop (parent controls refetching)
  useEffect(() => {
    if (domainFilterProp !== undefined && domainFilterProp !== settings.domainFilter) {
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
        });
      }
    } else {
      if (soundEngineRef.current) {
        soundEngineRef.current.dispose();
        soundEngineRef.current = null;
      }
    }
    return () => {
      soundEngineRef.current?.dispose();
      soundEngineRef.current = null;
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
  const vizSet = useMemo(() => new Set(activeVisualizations), [activeVisualizations]);
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

  // Persist settings to localStorage
  useEffect(() => {
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

  const cursorSettings = useMemo(
    () => ({
      trailOpacity: settings.trailOpacity,
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
      settings.trailOpacity,
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
  } = useCursorTrails(events, viewportSize, cursorSettings);

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
    const flat: ScheduledClick[] = [];
    trailStates.forEach((state, trailIndex) => {
      const { startOffsetMs, durationMs, trail, clicksWithProgress } = state;
      clicksWithProgress.forEach((click, clickIdx) => {
        const spawnAtMs = startOffsetMs + click.progress * durationMs;
        flat.push({
          id: `trail-${trailIndex}-click-${clickIdx}`,
          x: click.x,
          y: click.y,
          color: trail.color,
          spawnAtMs,
          holdDuration: click.duration,
        });
      });
    });
    if (flat.length === 0)
      return { scheduledClicks: [], clickCycleDuration: 0 };

    flat.sort((a, b) => a.spawnAtMs - b.spawnAtMs);

    const avgRippleDurationMs =
      (settings.clickMinDuration + settings.clickMaxDuration) / 2;
    const overlapMultiplier = 1 - settings.overlapFactor * 0.8;
    const baseInterval =
      (avgRippleDurationMs / settings.maxConcurrentTrails) * overlapMultiplier;
    const minGapMs = settings.minGapBetweenTrails * 1000;
    const actualSpawnIntervalMs = Math.max(minGapMs, baseInterval);

    const scheduledClicks: ScheduledClick[] = flat.map((c, i) => ({
      ...c,
      spawnAtMs: i * actualSpawnIntervalMs,
    }));
    const clickCycleDuration = flat.length * actualSpawnIntervalMs;

    return { scheduledClicks, clickCycleDuration };
  }, [
    trailStates,
    settings.maxConcurrentTrails,
    settings.overlapFactor,
    settings.minGapBetweenTrails,
    settings.clickMinDuration,
    settings.clickMaxDuration,
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
    events,
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
    events,
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
    events,
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

  const { radialState } = useNavigationRadial(events, navigationRadialSettings);

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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="internet-movement">
      <Controls
        visible={controlsVisible}
        settings={settings}
        setSettings={setSettings}
        loading={loading}
        error={error}
        events={events}
        trails={trails}
        availableDomains={availableDomains}
        fetchEvents={fetchEvents}
        timeRange={timeRange}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={onSetActiveVisualizations}
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

      <button
        onClick={() => setSoundEnabled((prev) => !prev)}
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3d3833" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
            soundEngine={soundEnabled ? soundEngineRef.current : null}
            settings={{
              strokeWidth: settings.strokeWidth,
              pointSize: settings.pointSize,
              trailOpacity: settings.trailOpacity,
              animationSpeed: settings.animationSpeed,
              clickMinRadius: settings.clickMinRadius,
              clickMaxRadius: settings.clickMaxRadius,
              clickMinDuration: settings.clickMinDuration,
              clickMaxDuration: settings.clickMaxDuration,
              clickExpansionDuration: settings.clickExpansionDuration,
              clickStrokeWidth: settings.clickStrokeWidth,
              clickOpacity: settings.clickOpacity,
              clickNumRings: settings.clickNumRings,
              clickRingDelayMs: settings.clickRingDelayMs,
              clickAnimationStopPoint: settings.clickAnimationStopPoint,
              monochromeMode: settings.monochromeMode,
            }}
          />
        )}

        {showClicks && (
          <AnimatedClicks
            key={`clicks-${settings.domainFilter}`}
            scheduledClicks={scheduledClicks}
            timeRange={{ duration: clickCycleDuration }}
            settings={{
              animationSpeed: settings.animationSpeed,
              clickMinRadius: settings.clickMinRadius,
              clickMaxRadius: settings.clickMaxRadius,
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

        {showScrolling &&
          scrollAnimations &&
          scrollAnimations.length > 0 && (
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
            events={events}
            domainFilter={settings.domainFilter}
          />
        )}
      </div>

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
