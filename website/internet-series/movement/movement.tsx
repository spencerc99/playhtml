// ABOUTME: Main coordinator component for the Internet Movement visualization
// ABOUTME: Handles data fetching, settings management, and delegates event processing to specialized hooks
import "./movement.scss";
import React, { useState, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "./types";
import { Controls } from "./components/Controls";
import { AnimatedTrails } from "./components/AnimatedTrails";
import { AnimatedTyping } from "./components/AnimatedTyping";
import { AnimatedScrollViewports } from "./components/AnimatedScrollViewports";
import { AnimatedNavigation } from "./components/AnimatedNavigation";
import { AnimatedNavigationRadial } from "./components/AnimatedNavigationRadial";

// Import event-specific hooks
import { useCursorTrails } from "./hooks/useCursorTrails";
import { useKeyboardTyping } from "./hooks/useKeyboardTyping";
import { useViewportScroll } from "./hooks/useViewportScroll";
import { useNavigationTimeline } from "./hooks/useNavigationTimeline";
import { useNavigationRadial } from "./hooks/useNavigationRadial";

// Import shared utilities
import { extractDomain } from "./utils/eventUtils";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

const SETTINGS_STORAGE_KEY = "internet-movement-settings";

const loadSettings = () => {
  const defaults = {
    trailOpacity: 0.7,
    strokeWidth: 5,
    pointSize: 4,
    animationSpeed: 1,
    trailStyle: "chaotic" as "straight" | "smooth" | "organic" | "chaotic",
    maxConcurrentTrails: 5,
    trailAnimationMode: "stagger" as "natural" | "stagger",
    trailLifetime: 1.0,
    overlapFactor: 0.5,
    randomizeColors: false,
    minGapBetweenTrails: 0.5,
    chaosIntensity: 1.0,
    clickMinRadius: 10,
    clickMaxRadius: 80,
    clickMinDuration: 500,
    clickMaxDuration: 2500,
    clickStrokeWidth: 4,
    clickOpacity: 0.3,
    clickNumRings: 6,
    clickRingDelayMs: 360,
    clickExpansionDuration: 12300,
    clickAnimationStopPoint: 0.45,
    eventFilter: {
      move: true,
      click: true,
      hold: true,
      cursor_change: true,
    },
    eventTypeFilter: {
      cursor: true,
      keyboard: true,
      viewport: false,
      navigation: false,
    },
    viewportEventFilter: {
      scroll: true,
      resize: true,
      zoom: true,
    },
    domainFilter: "",
    scrollSpeed: 1.0,
    backgroundOpacity: 0.7,
    maxConcurrentScrolls: 5,
    scrollOverlapFactor: 0.8,
    minViewports: 10,
    maxViewports: 50,
    keyboardOverlapFactor: 0.9,
    textboxOpacity: 0.2,
    keyboardMinFontSize: 12,
    keyboardMaxFontSize: 18,
    keyboardShowCaret: true,
    keyboardAnimationSpeed: 0.5,
    keyboardPositionRandomness: 0.3,
    keyboardRandomizeOrder: false,
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
  };

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...defaults,
        ...parsed,
        eventFilter: {
          ...defaults.eventFilter,
          ...(parsed.eventFilter || {}),
        },
        eventTypeFilter: {
          ...defaults.eventTypeFilter,
          ...(parsed.eventTypeFilter || {}),
        },
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

const InternetMovement = () => {
  const [settings, setSettings] = useState(loadSettings());
  const [controlsVisible, setControlsVisible] = useState(false);
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  // Save settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error("Failed to save settings to localStorage:", err);
    }
  }, [settings]);

  // Fetch events from API
  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: "5000",
      });

      const promises: Promise<CollectionEvent[]>[] = [];

      if (settings.eventTypeFilter.cursor) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=cursor`)
            .then((res) => {
              if (!res.ok)
                throw new Error(`Failed to fetch cursor events: ${res.status}`);
              return res.json();
            })
            .then((events) => {
              console.log(`[Fetch] Received ${events.length} cursor events`);
              return events;
            }),
        );
      }

      if (settings.eventTypeFilter.keyboard) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=keyboard`)
            .then((res) => {
              if (!res.ok)
                throw new Error(
                  `Failed to fetch keyboard events: ${res.status}`,
                );
              return res.json();
            })
            .then((events) => {
              console.log(`[Fetch] Received ${events.length} keyboard events`);
              return events;
            }),
        );
      }

      if (settings.eventTypeFilter.viewport) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=viewport`).then((res) => {
            if (!res.ok)
              throw new Error(`Failed to fetch viewport events: ${res.status}`);
            return res.json();
          }),
        );
      }

      if (settings.eventTypeFilter.navigation) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=navigation`)
            .then((res) => {
              if (!res.ok)
                throw new Error(
                  `Failed to fetch navigation events: ${res.status}`,
                );
              return res.json();
            })
            .then((events) => {
              console.log(
                `[Fetch] Received ${events.length} navigation events`,
              );
              return events;
            }),
        );
      }

      if (promises.length === 0) {
        setEvents([]);
        return;
      }

      const results = await Promise.all(promises);
      const allEvents = results.flat();
      setEvents(allEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    fetchEvents();
  }, []);

  // Keyboard shortcuts (double-tap D to toggle controls, double-tap R to refresh)
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
  }, []);

  // Track viewport size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const newSize = {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        };
        setViewportSize(newSize);
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
      if (domain) {
        domains.add(domain);
      }
    });
    return Array.from(domains).sort();
  }, [events]);

  // Clear domain filter if it's not in available domains
  useEffect(() => {
    if (
      events.length > 0 &&
      settings.domainFilter &&
      availableDomains.length > 0 &&
      !availableDomains.includes(settings.domainFilter)
    ) {
      console.log(
        `[Domain Filter] Clearing filter for "${settings.domainFilter}" - not found in available domains`,
      );
      setSettings((s) => ({ ...s, domainFilter: "" }));
    }
  }, [events.length]);

  // ============================================================
  // Event-specific processing via hooks
  // ============================================================

  // Process cursor events into trails
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
    ],
  );

  const {
    trails,
    trailStates,
    timeBounds: cursorTimeBounds,
    cycleDuration: cursorCycleDuration,
  } = useCursorTrails(events, viewportSize, cursorSettings);

  // Compute unified time range from all event types
  // This ensures animations across different event types are synchronized
  const timeRange = useMemo(() => {
    const allMins: number[] = [];
    const allMaxs: number[] = [];

    // Collect time bounds from cursor trails
    if (cursorTimeBounds.min > 0 || cursorTimeBounds.max > 0) {
      allMins.push(cursorTimeBounds.min);
      allMaxs.push(cursorTimeBounds.max);
    }

    // Use cursor cycle duration if available, otherwise estimate
    const duration = cursorCycleDuration > 0 ? cursorCycleDuration : 60000;

    if (allMins.length === 0) {
      return { min: 0, max: 0, duration };
    }

    const min = Math.min(...allMins);
    const max = Math.max(...allMaxs);

    return { min, max, duration };
  }, [cursorTimeBounds, cursorCycleDuration]);

  // Process keyboard events into typing animations
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

  // Process viewport events into scroll animations
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

  // Process navigation events into timeline
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
    }),
    [
      settings.domainFilter,
      settings.navigationMaxSessions,
      settings.navigationMinSessionEvents,
      viewportSize.width,
      viewportSize.height,
    ],
  );

  const { radialState } = useNavigationRadial(events, navigationRadialSettings);

  // ============================================================
  // Memoized settings objects for child components
  // ============================================================

  const typingSettings = useMemo(
    () => ({
      animationSpeed: settings.animationSpeed,
      textboxOpacity: settings.textboxOpacity,
      keyboardShowCaret: settings.keyboardShowCaret,
      keyboardAnimationSpeed: settings.keyboardAnimationSpeed,
    }),
    [
      settings.animationSpeed,
      settings.textboxOpacity,
      settings.keyboardShowCaret,
      settings.keyboardAnimationSpeed,
    ],
  );

  const scrollSettings = useMemo(
    () => ({
      scrollSpeed: settings.scrollSpeed,
      backgroundOpacity: settings.backgroundOpacity,
      maxConcurrentScrolls: settings.maxConcurrentScrolls,
      randomizeColors: settings.randomizeColors,
    }),
    [
      settings.scrollSpeed,
      settings.backgroundOpacity,
      settings.maxConcurrentScrolls,
      settings.randomizeColors,
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

  // ============================================================
  // Render
  // ============================================================

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

        {settings.eventTypeFilter.cursor && (
          <AnimatedTrails
            key={settings.domainFilter}
            trailStates={trailStates}
            timeRange={timeRange}
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
            }}
          />
        )}

        {settings.eventTypeFilter.keyboard && (
          <AnimatedTyping
            typingStates={typingStates}
            timeRange={timeRange}
            settings={typingSettings}
          />
        )}

        {settings.eventTypeFilter.viewport &&
          scrollAnimations &&
          scrollAnimations.length > 0 && (
            <AnimatedScrollViewports
              animations={scrollAnimations}
              canvasSize={viewportSize}
              settings={scrollSettings}
            />
          )}

        {settings.eventTypeFilter.navigation &&
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
                blob: {
                  samples: settings.navigationRadialBlobSamples,
                  curveTension: settings.navigationRadialBlobCurveTension,
                  edgeNoise: settings.navigationRadialBlobEdgeNoise,
                  valleyDepth: settings.navigationRadialBlobValleyDepth,
                },
              }}
            />
          )}

        {settings.eventTypeFilter.navigation &&
          (settings.navigationViewMode ?? "timeline") === "timeline" &&
          timelineState &&
          timelineState.nodes.size > 0 && (
            <AnimatedNavigation
              timelineState={timelineState}
              canvasSize={viewportSize}
              settings={navigationSettings}
            />
          )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetMovement />);
