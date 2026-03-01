// ABOUTME: Main overlay component that renders historical browsing data on pages
// ABOUTME: Reuses visualization components from website/internet-series/movement/

import React, { useState, useEffect, useRef, useMemo } from "react";
import browser from "webextension-polyfill";
import { loadHistoricalData, type FilterMode } from "../storage/historyLoader";
import { VERBOSE } from "../config";
import type { CollectionEvent, CollectionEventType } from "../collectors/types";
import { determineFilterScope, extractDomain } from "../utils/urlNormalization";
import {
  compositePagePortrait,
  pagePortraitFilename,
} from "../utils/portraitExport";
import { PortraitCardDirectionA, type PortraitCardProps } from "./PortraitCard";

// Import visualization components from movement
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import {
  AnimatedClicks,
  type ScheduledClick,
} from "../../../website/internet-series/movement/components/AnimatedClicks";
import { AnimatedTyping } from "../../../website/internet-series/movement/components/AnimatedTyping";
import { AnimatedScrollViewports } from "../../../website/internet-series/movement/AnimatedScrollViewports";

// Import hooks
import { useCursorTrails } from "../../../website/internet-series/movement/hooks/useCursorTrails";
import { useKeyboardTyping } from "../../../website/internet-series/movement/hooks/useKeyboardTyping";
import { useViewportScroll } from "../../../website/internet-series/movement/hooks/useViewportScroll";

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

  // When true, cursor positions are shown in document space (full scrollable page)
  documentSpace: boolean;
}

export const defaultSettings: OverlaySettings = {
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
  documentSpace: false,
};

interface Props {
  visible: boolean;
  currentUrl: string;
  onClose: () => void;
}

export function HistoricalOverlay({ visible, currentUrl, onClose }: Props) {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<OverlaySettings>(defaultSettings);
  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const [filterMode, setFilterMode] = useState<FilterMode>("auto");
  const [forceServerBackfill, setForceServerBackfill] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [portraitStats, setPortraitStats] = useState<PortraitCardProps | null>(null);
  const [portraitStatsLoaded, setPortraitStatsLoaded] = useState(false);
  const prevDomainRef = useRef<string>(extractDomain(currentUrl));

  // Load dev mode setting from storage once on mount
  useEffect(() => {
    browser.storage.local.get(["dev_mode"]).then((result) => {
      setDevMode(Boolean(result["dev_mode"]));
    }).catch(() => {});
  }, []);

  // When URL changes, reset filterMode only if the domain changed
  useEffect(() => {
    const newDomain = extractDomain(currentUrl);
    if (newDomain !== prevDomainRef.current) {
      setFilterMode("auto");
      prevDomainRef.current = newDomain;
    }
  }, [currentUrl]);

  // Determine filter scope based on current URL
  const filterScope = useMemo(() => {
    return determineFilterScope(currentUrl);
  }, [currentUrl]);

  const actualMode = filterMode === "auto" ? filterScope.mode : filterMode;
  const domain = useMemo(() => extractDomain(currentUrl), [currentUrl]);

  // Sync documentSpace with actualMode: domain view never uses doc space,
  // page view defaults to doc space (trails shown relative to full scrollable page)
  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      documentSpace: actualMode !== "domain",
    }));
  }, [actualMode]);

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

    if (VERBOSE) console.log(
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

        if (VERBOSE) console.log(
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

  // Fetch portrait stats on mount and when filter mode or domain changes
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const res: any = await browser.runtime.sendMessage({
          type: "GET_DOMAIN_STATS",
          domain,
        });
        if (res?.success && res.stats) {
          setPortraitStats({
            domain: actualMode === "domain" ? domain : new URL(currentUrl).pathname,
            totalTimeMs: res.stats.totalTimeMs,
            sessions: res.stats.sessions ?? [],
            cursorDistancePx: res.stats.cursorDistancePx ?? 0,
            dateRange: res.stats.dateRange,
            uniquePageCount: res.stats.uniquePageCount,
          });
        }
        setPortraitStatsLoaded(true);
      } catch (e) {
        console.error("[HistoricalOverlay] Failed to fetch portrait stats", e);
        setPortraitStatsLoaded(true);
      }
    })();
  }, [visible, actualMode, currentUrl, domain]);

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
      documentSpace: settings.documentSpace,
    }),
    [settings, domain],
  );

  const {
    trails,
    trailStates,
    timeBounds: cursorTimeBounds,
    cycleDuration: cursorCycleDuration,
    documentCanvasSize,
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

  async function handleCapturePagePortrait() {
    try {
      const response: { dataUrl?: string; error?: string } =
        await browser.runtime.sendMessage({ type: "CAPTURE_PAGE_PORTRAIT" });
      if (response.error || !response.dataUrl) {
        console.error("[HistoricalOverlay] Capture failed:", response.error);
        return;
      }
      const svgEl = document.querySelector(".trails-svg") as SVGSVGElement | null;
      if (!svgEl) {
        console.error("[HistoricalOverlay] Could not find .trails-svg element");
        return;
      }
      await compositePagePortrait(
        response.dataUrl,
        svgEl,
        pagePortraitFilename(domain),
      );
    } catch (err) {
      console.error("[HistoricalOverlay] Export failed:", err);
    }
  }

  if (!visible) return null;

  const overlayStyles: React.CSSProperties = settings.documentSpace
    ? {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: documentCanvasSize
          ? `${documentCanvasSize.height}px`
          : "100%",
        zIndex: 2147483647,
        pointerEvents: "none",
        overflow: "visible",
        background: "transparent",
      }
    : {
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

  // Shared micro-button style for action strip
  const actionBtnBase: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: "0 6px",
    cursor: "pointer",
    fontSize: "11px",
    color: "rgba(61,56,51,0.6)",
    fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
    lineHeight: 1,
    transition: "color 0.15s",
    whiteSpace: "nowrap" as const,
  };

  const scopeBtnStyle = (active: boolean): React.CSSProperties => ({
    ...actionBtnBase,
    color: active ? "#3d3833" : "rgba(61,56,51,0.4)",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={overlayStyles} ref={containerRef}>
      {/* Floating portrait card + action strip — bottom-right corner */}
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0",
          width: "280px",
        }}
      >
        {/* Portrait card */}
        <div
          style={{
            position: "relative",
            height: "160px",
            borderRadius: "10px 10px 0 0",
            overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
            border: "1px solid rgba(61,56,51,0.12)",
            borderBottom: "none",
          }}
        >
          {portraitStats ? (
            <PortraitCardDirectionA {...portraitStats} />
          ) : portraitStatsLoaded ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "#f5f0e8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                color: "rgba(61,56,51,0.4)",
                fontFamily: "'Martian Mono', monospace",
              }}
            >
              no data
            </div>
          ) : null}

        </div>

        {/* Action strip — two rows */}
        <div
          style={{
            background: forceServerBackfill
              ? "rgba(212,184,92,0.95)"
              : "rgba(250,247,242,0.97)",
            borderRadius: "0 0 10px 10px",
            border: "1px solid rgba(61,56,51,0.12)",
            borderTop: "1px solid rgba(61,56,51,0.08)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          }}
        >
          {/* Row 1: scope toggle + full portrait link */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              height: "30px",
              borderBottom: "1px solid rgba(61,56,51,0.07)",
              gap: "2px",
            }}
          >
            <button
              style={scopeBtnStyle(actualMode === "domain")}
              onClick={() => setFilterMode("domain")}
              title="Show all pages on this domain"
            >
              ◉ Domain
            </button>
            <span style={{ color: "rgba(61,56,51,0.18)", fontSize: "10px" }}>|</span>
            <button
              style={scopeBtnStyle(actualMode !== "domain")}
              onClick={() => setFilterMode("url")}
              title="Show this page only"
            >
              ▤ Page
            </button>
            <span style={{ color: "rgba(61,56,51,0.18)", fontSize: "10px", padding: "0 4px" }}>|</span>
            <button
              style={{ ...actionBtnBase, fontSize: "10px" }}
              onClick={() => browser.runtime.sendMessage({ type: "OPEN_TAB", url: browser.runtime.getURL("portrait.html") })}
              title="Open full internet portrait in new tab"
              onMouseEnter={(e) => { e.currentTarget.style.color = "#3d3833"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(61,56,51,0.6)"; }}
            >
              the internet ↗
            </button>
          </div>

          {/* Row 2: save + close */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              height: "30px",
            }}
          >
            <button
              style={actionBtnBase}
              onClick={handleCapturePagePortrait}
              title="Save page portrait as image"
              onMouseEnter={(e) => { e.currentTarget.style.color = "#3d3833"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(61,56,51,0.6)"; }}
            >
              ↓ save image
            </button>

            <button
              style={{ ...actionBtnBase, marginLeft: "auto" }}
              onClick={onClose}
              title="Close overlay"
              onMouseEnter={(e) => { e.currentTarget.style.color = "#3d3833"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(61,56,51,0.6)"; }}
            >
              close ✕
            </button>
          </div>
        </div>
      </div>

      {/* Dev mode bottom bar — event type toggles and status */}
      {devMode && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 2147483647,
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "8px 16px",
            background: forceServerBackfill
              ? "rgba(212,184,92,0.92)"
              : "rgba(250,247,242,0.97)",
            borderTop: "1px solid rgba(61,56,51,0.15)",
            backdropFilter: "blur(8px)",
            fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
            fontSize: "11px",
            color: "#3d3833",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(61,56,51,0.5)" }}>
            dev
          </span>
          {[
            { label: "Trails", key: "showCursorTrails" as const },
            { label: "Doc space", key: "documentSpace" as const },
            { label: "Clicks", key: "showCursorClicks" as const },
            { label: "Typing", key: "showTyping" as const },
            { label: "Scrolls", key: "showScrolls" as const },
          ].map(({ label, key }) => (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                cursor: "pointer",
                userSelect: "none",
                fontSize: "11px",
                fontWeight: 600,
                color: settings[key] ? "#3d3833" : "rgba(61,56,51,0.4)",
                letterSpacing: "0.03em",
                textTransform: "uppercase",
              }}
            >
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                style={{ cursor: "pointer", width: "14px", height: "14px", accentColor: "#4a9a8a" }}
              />
              {label}
            </label>
          ))}
          {loading && (
            <span style={{ marginLeft: "auto", color: "rgba(61,56,51,0.5)" }}>loading...</span>
          )}
          {error && (
            <span style={{ marginLeft: "auto", color: "#9a5a3a" }}>{error}</span>
          )}
          {forceServerBackfill && (
            <span style={{ color: "rgba(61,56,51,0.6)", fontSize: "10px" }}>• server</span>
          )}
        </div>
      )}

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

      {/* Loading / empty state for canvas area */}
      {(loading || events.length === 0) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            color: "rgba(61,56,51,0.4)",
            fontFamily: "'Martian Mono', monospace",
            pointerEvents: "none",
          }}
        >
          {loading ? "loading..." : "no data"}
        </div>
      )}

      {/* Animation layers */}
      {!loading && events.length > 0 && (
        <>
          {settings.showCursorTrails && (
            <AnimatedTrails
              trailStates={trailStates}
              timeRange={timeRange}
              showClickRipples={!settings.showCursorClicks}
              windowSize={settings.maxConcurrentTrails * 3}
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
