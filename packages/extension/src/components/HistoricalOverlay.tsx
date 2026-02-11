// ABOUTME: Main overlay component that renders historical browsing data on pages
// ABOUTME: Reuses visualization components from website/internet-series/movement/

import React, { useState, useEffect, useRef, useMemo } from "react";
import { loadHistoricalData, type FilterMode } from "../storage/historyLoader";
import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import { determineFilterScope, extractDomain } from "../utils/urlNormalization";

// Import visualization components from movement
import { AnimatedTrails } from "../../../../website/internet-series/movement/components/AnimatedTrails";
import {
  AnimatedClicks,
  type ScheduledClick,
} from "../../../../website/internet-series/movement/components/AnimatedClicks";
import { AnimatedTyping } from "../../../../website/internet-series/movement/components/AnimatedTyping";
import { AnimatedScrollViewports } from "../../../../website/internet-series/movement/AnimatedScrollViewports";

// Import hooks
import { useCursorTrails } from "../../../../website/internet-series/movement/hooks/useCursorTrails";
import { useKeyboardTyping } from "../../../../website/internet-series/movement/hooks/useKeyboardTyping";
import { useViewportScroll } from "../../../../website/internet-series/movement/hooks/useViewportScroll";

// Note: Styles are inlined below since this component is injected into arbitrary web pages
// and external stylesheets don't get bundled with content script injections

interface OverlaySettings {
  // Visibility toggles
  showCursorTrails: boolean;
  showCursorClicks: boolean;
  showTyping: boolean;
  showScrolls: boolean;

  // Visual settings
  trailOpacity: number;
  animationSpeed: number;
  strokeWidth: number;
  pointSize: number;

  // Animation settings
  trailStyle: "straight" | "smooth" | "organic" | "chaotic";
  maxConcurrentTrails: number;
  randomizeColors: boolean;
}

const defaultSettings: OverlaySettings = {
  showCursorTrails: true,
  showCursorClicks: false,
  showTyping: false,
  showScrolls: false,
  trailOpacity: 0.7,
  animationSpeed: 1.0,
  strokeWidth: 5,
  pointSize: 4,
  trailStyle: "chaotic",
  maxConcurrentTrails: 15,
  randomizeColors: true,
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function HistoricalOverlay({ visible, onClose }: Props) {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<OverlaySettings>(defaultSettings);
  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const currentUrl = window.location.href;
  const [filterMode, setFilterMode] = useState<FilterMode>("auto");
  const [forceServerBackfill, setForceServerBackfill] = useState(false);

  // Determine filter scope based on current URL
  const filterScope = useMemo(() => {
    return determineFilterScope(currentUrl);
  }, [currentUrl]);

  const actualMode = filterMode === "auto" ? filterScope.mode : filterMode;
  const domain = useMemo(() => extractDomain(currentUrl), [currentUrl]);

  // Fetch only the event types that are enabled for rendering
  const requestedTypes = useMemo((): CollectionEventType[] => {
    const types: CollectionEventType[] = [];
    if (settings.showCursorTrails || settings.showCursorClicks) {
      types.push("cursor");
    }
    if (settings.showTyping) {
      types.push("keyboard");
    }
    if (settings.showScrolls) {
      types.push("viewport");
    }
    // Always fetch at least cursor events to prevent empty state
    if (types.length === 0) {
      types.push("cursor");
    }
    return types;
  }, [
    settings.showCursorTrails,
    settings.showCursorClicks,
    settings.showTyping,
    settings.showScrolls,
  ]);

  // Load events when overlay becomes visible or when enabled event types change
  useEffect(() => {
    if (!visible) return;

    console.log(
      `[HistoricalOverlay] Loading data - forceServerBackfill: ${forceServerBackfill}`,
    );

    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const historicalEvents = await loadHistoricalData(
          currentUrl,
          filterMode,
          {
            limit: 5000,
            types: requestedTypes,
            forceServerBackfill,
          },
        );

        console.log(
          `[HistoricalOverlay] Loaded ${historicalEvents.length} total events`,
        );
        setEvents(historicalEvents);
        setLoading(false);
      } catch (err) {
        console.error("[HistoricalOverlay] Failed to load data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load historical data",
        );
        setLoading(false);
      }
    };

    loadData();
  }, [visible, currentUrl, filterMode, requestedTypes, forceServerBackfill]);

  // Obscure keyboard shortcut for forced server backfill
  // Mac: Cmd+Shift+9
  // Windows/Linux: Ctrl+Shift+9
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const modifierPressed = (e.metaKey || e.ctrlKey) && e.shiftKey;
      if (modifierPressed && e.key === "9") {
        e.preventDefault();
        setForceServerBackfill((prev) => {
          const newState = !prev;
          console.log(
            `[HistoricalOverlay] Server backfill ${
              newState ? "enabled" : "disabled"
            }`,
          );
          return newState;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible]);

  // Track viewport size
  useEffect(() => {
    const updateSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Process cursor events
  const cursorSettings = useMemo(
    () => ({
      trailOpacity: settings.trailOpacity,
      randomizeColors: settings.randomizeColors,
      domainFilter: domain,
      eventFilter: {
        move: true,
        click: true,
        hold: true,
        cursor_change: true,
      },
      trailStyle: settings.trailStyle,
      chaosIntensity: 1.0,
      trailAnimationMode: "stagger" as const,
      maxConcurrentTrails: settings.maxConcurrentTrails,
      overlapFactor: 0.75,
      minGapBetweenTrails: 0.2,
    }),
    [settings, domain],
  );

  const {
    trails,
    trailStates,
    timeBounds: cursorTimeBounds,
    cycleDuration: cursorCycleDuration,
  } = useCursorTrails(events, viewportSize, cursorSettings);

  // Compute unified time range
  const timeRange = useMemo(() => {
    const duration = cursorCycleDuration > 0 ? cursorCycleDuration : 60000;
    return {
      min: cursorTimeBounds.min || 0,
      max: cursorTimeBounds.max || 0,
      duration,
    };
  }, [cursorTimeBounds, cursorCycleDuration]);

  // Schedule clicks
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

    const avgRippleDurationMs = 1500;
    const overlapMultiplier = 0.6;
    const baseInterval =
      (avgRippleDurationMs / settings.maxConcurrentTrails) * overlapMultiplier;
    const minGapMs = 500;
    const actualSpawnIntervalMs = Math.max(minGapMs, baseInterval);

    const scheduledClicks: ScheduledClick[] = flat.map((c, i) => ({
      ...c,
      spawnAtMs: i * actualSpawnIntervalMs,
    }));

    const clickCycleDuration = flat.length * actualSpawnIntervalMs;

    return { scheduledClicks, clickCycleDuration };
  }, [trailStates, settings.maxConcurrentTrails]);

  // Process keyboard events
  const keyboardSettings = useMemo(
    () => ({
      domainFilter: domain,
      keyboardOverlapFactor: 0.9,
      keyboardMinFontSize: 12,
      keyboardMaxFontSize: 18,
      keyboardPositionRandomness: 0.3,
      keyboardRandomizeOrder: false,
    }),
    [domain],
  );

  const { typingStates } = useKeyboardTyping(
    events,
    viewportSize,
    keyboardSettings,
    timeRange.duration,
    timeRange.min,
  );

  // Process viewport events
  const viewportSettings = useMemo(
    () => ({
      domainFilter: domain,
      viewportEventFilter: {
        scroll: true,
        resize: true,
        zoom: true,
      },
    }),
    [domain],
  );

  const { animations: scrollAnimations } = useViewportScroll(
    events,
    viewportSize,
    viewportSettings,
  );

  // Compute event type counts (filtered by what's actually being visualized)
  const eventCounts = useMemo(() => {
    const counts: Record<string, number> = {
      cursor: 0,
      keyboard: 0,
      viewport: 0,
    };
    events.forEach((evt) => {
      // Only count events that are currently being visualized
      if (
        evt.type === "cursor" &&
        (settings.showCursorTrails || settings.showCursorClicks)
      ) {
        counts.cursor++;
      } else if (evt.type === "keyboard" && settings.showTyping) {
        counts.keyboard++;
      } else if (evt.type === "viewport" && settings.showScrolls) {
        counts.viewport++;
      }
    });
    return counts;
  }, [
    events,
    settings.showCursorTrails,
    settings.showCursorClicks,
    settings.showTyping,
    settings.showScrolls,
  ]);

  // Compute date range
  const dateRange = useMemo(() => {
    if (events.length === 0) return null;
    const timestamps = events.map((e) => e.ts);
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);
    return {
      oldest: new Date(oldest).toLocaleDateString(),
      newest: new Date(newest).toLocaleDateString(),
    };
  }, [events]);

  if (!visible) return null;

  const overlayStyles: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 2147483647,
    pointerEvents: "none",
    overflow: "hidden",
    background: "transparent",
  };

  const infoBarStyles: React.CSSProperties = {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2147483647,
    pointerEvents: "auto",
    display: "flex",
    flexWrap: "wrap", // Allow wrapping on small screens
    alignItems: "center",
    gap: "16px",
    padding: "12px 16px",
    background: forceServerBackfill
      ? "rgba(255, 237, 213, 0.98)"
      : "rgba(255, 255, 255, 0.98)",
    borderTop: forceServerBackfill
      ? "2px solid rgba(245, 158, 11, 0.5)"
      : "2px solid rgba(0, 0, 0, 0.1)",
    boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.08)",
    backdropFilter: "blur(10px)",
    fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
    fontSize: "12px",
  };

  const infoSectionStyles: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: "150px",
    flex: "0 1 auto", // Allow shrinking on small screens
  };

  const domainStyles: React.CSSProperties = {
    fontWeight: 700,
    fontSize: "14px",
    color: "#1f2937",
    letterSpacing: "0.3px",
  };

  const dateRangeStyles: React.CSSProperties = {
    fontSize: "11px",
    color: "#6b7280",
    fontWeight: 500,
  };

  const eventCountsStyles: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap", // Wrap on small screens
    gap: "12px",
    paddingLeft: "16px",
    borderLeft: "2px solid rgba(0, 0, 0, 0.1)",
  };

  const countItemStyles: React.CSSProperties = {
    display: "flex",
    gap: "6px",
    alignItems: "baseline",
  };

  const countLabelStyles: React.CSSProperties = {
    fontSize: "11px",
    color: "#6b7280",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  const countValueStyles: React.CSSProperties = {
    fontSize: "14px",
    fontWeight: 700,
    color: "#1f2937",
  };

  const togglesContainerStyles: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginLeft: "auto",
    paddingRight: "8px",
  };

  const toggleLabelStyles: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
    userSelect: "none",
    fontSize: "11px",
    fontWeight: 600,
    color: "#374151",
    letterSpacing: "0.3px",
    textTransform: "uppercase",
  };

  const checkboxStyles: React.CSSProperties = {
    cursor: "pointer",
    width: "16px",
    height: "16px",
    accentColor: "#6366f1",
  };

  const closeButtonStyles: React.CSSProperties = {
    background: "#1f2937",
    color: "white",
    border: "none",
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
    transition: "background 0.2s, transform 0.1s",
  };

  const loadingStatusStyles: React.CSSProperties = {
    fontSize: "12px",
    color: "#6b7280",
    fontWeight: 500,
    marginLeft: "auto",
  };

  const errorStatusStyles: React.CSSProperties = {
    fontSize: "12px",
    color: "#dc2626",
    fontWeight: 600,
    marginLeft: "auto",
  };

  return (
    <div style={overlayStyles} ref={containerRef}>
      {/* Bottom info bar */}
      <div style={infoBarStyles}>
        <div style={infoSectionStyles}>
          <div style={domainStyles}>
            {actualMode === "domain" ? domain : filterScope.displayPath}
          </div>
          <div style={dateRangeStyles}>
            {actualMode === "domain" ? "All pages" : "This page only"}
            {forceServerBackfill && " • 🌐 Server"}
          </div>
          {dateRange && (
            <div style={{ ...dateRangeStyles, marginTop: "2px" }}>
              {dateRange.oldest === dateRange.newest
                ? dateRange.oldest
                : `${dateRange.oldest} - ${dateRange.newest}`}
            </div>
          )}
        </div>

        {/* Filter mode toggle - minimal */}
        <button
          onClick={() =>
            setFilterMode(actualMode === "domain" ? "url" : "domain")
          }
          title={
            actualMode === "domain"
              ? "Switch to this page only"
              : "Switch to all pages"
          }
          style={{
            background: "transparent",
            border: "1px solid rgba(0, 0, 0, 0.2)",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "16px",
            cursor: "pointer",
            transition: "all 0.2s",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 0, 0, 0.05)";
            e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.2)";
          }}
        >
          {actualMode === "domain" ? "🌐" : "📄"}
        </button>

        {!loading && events.length > 0 && (
          <>
            <div style={eventCountsStyles}>
              <div style={countItemStyles}>
                <span style={countLabelStyles}>Cursor:</span>
                <span style={countValueStyles}>{eventCounts.cursor}</span>
              </div>
              <div style={countItemStyles}>
                <span style={countLabelStyles}>Keyboard:</span>
                <span style={countValueStyles}>{eventCounts.keyboard}</span>
              </div>
              <div style={countItemStyles}>
                <span style={countLabelStyles}>Viewport:</span>
                <span style={countValueStyles}>{eventCounts.viewport}</span>
              </div>
            </div>

            <div style={togglesContainerStyles}>
              <label style={toggleLabelStyles}>
                <input
                  type="checkbox"
                  style={checkboxStyles}
                  checked={settings.showCursorTrails}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      showCursorTrails: e.target.checked,
                    })
                  }
                />
                <span>Trails</span>
              </label>
              <label style={toggleLabelStyles}>
                <input
                  type="checkbox"
                  style={checkboxStyles}
                  checked={settings.showCursorClicks}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      showCursorClicks: e.target.checked,
                    })
                  }
                />
                <span>Clicks</span>
              </label>
              <label style={toggleLabelStyles}>
                <input
                  type="checkbox"
                  style={checkboxStyles}
                  checked={settings.showTyping}
                  onChange={(e) =>
                    setSettings({ ...settings, showTyping: e.target.checked })
                  }
                />
                <span>Typing</span>
              </label>
              <label style={toggleLabelStyles}>
                <input
                  type="checkbox"
                  style={checkboxStyles}
                  checked={settings.showScrolls}
                  onChange={(e) =>
                    setSettings({ ...settings, showScrolls: e.target.checked })
                  }
                />
                <span>Scrolls</span>
              </label>
            </div>
          </>
        )}

        {loading && (
          <div style={loadingStatusStyles}>Loading historical data...</div>
        )}
        {error && <div style={errorStatusStyles}>{error}</div>}

        <button
          onClick={onClose}
          style={closeButtonStyles}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#111827";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#1f2937";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          Close
        </button>
      </div>

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
          <filter id="overlay-noise">
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
          <filter id="overlay-grain">
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
        </defs>
        <rect width="100%" height="100%" filter="url(#overlay-noise)" />
        <rect
          width="100%"
          height="100%"
          filter="url(#overlay-grain)"
          style={{ opacity: 0.3 }}
        />
      </svg>

      {/* Animation layers */}
      {!loading && events.length > 0 && (
        <>
          {settings.showCursorTrails && (
            <AnimatedTrails
              trailStates={trailStates}
              timeRange={timeRange}
              showClickRipples={!settings.showCursorClicks}
              settings={{
                strokeWidth: settings.strokeWidth,
                pointSize: settings.pointSize,
                trailOpacity: settings.trailOpacity,
                animationSpeed: settings.animationSpeed,
                clickMinRadius: 10,
                clickMaxRadius: 80,
                clickMinDuration: 500,
                clickMaxDuration: 2500,
                clickExpansionDuration: 12300,
                clickStrokeWidth: 4,
                clickOpacity: 0.3,
                clickNumRings: 6,
                clickRingDelayMs: 360,
                clickAnimationStopPoint: 0.45,
              }}
            />
          )}

          {settings.showCursorClicks && (
            <AnimatedClicks
              scheduledClicks={scheduledClicks}
              timeRange={{ duration: clickCycleDuration }}
              settings={{
                animationSpeed: settings.animationSpeed,
                clickMinRadius: 10,
                clickMaxRadius: 80,
                clickMinDuration: 500,
                clickMaxDuration: 2500,
                clickExpansionDuration: 12300,
                clickStrokeWidth: 4,
                clickOpacity: 0.3,
                clickNumRings: 6,
                clickRingDelayMs: 360,
                clickAnimationStopPoint: 0.45,
              }}
            />
          )}

          {settings.showTyping && (
            <AnimatedTyping
              typingStates={typingStates}
              timeRange={timeRange}
              settings={{
                animationSpeed: settings.animationSpeed,
                textboxOpacity: 0.2,
                keyboardShowCaret: true,
                keyboardAnimationSpeed: 0.5,
              }}
            />
          )}

          {settings.showScrolls &&
            scrollAnimations &&
            scrollAnimations.length > 0 && (
              <AnimatedScrollViewports
                animations={scrollAnimations}
                canvasSize={viewportSize}
                settings={{
                  scrollSpeed: 1.0,
                  backgroundOpacity: 0.7,
                  maxConcurrentScrolls: 5,
                  randomizeColors: settings.randomizeColors,
                }}
              />
            )}
        </>
      )}
    </div>
  );
}
