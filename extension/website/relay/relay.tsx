// ABOUTME: Trail relay experiment — chains archive cursor trails end-to-origin into
// ABOUTME: one continuous journey, played back as a relay of strangers' gestures
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import { AnimatedTrails } from "../shared/components/AnimatedTrails";
import {
  useCursorTrails,
  CursorTrailSettings,
} from "../shared/hooks/useCursorTrails";
import { useCursorEventPool } from "../shared/hooks/useCursorEventPool";
import { DEFAULT_SETTINGS } from "../shared/components/settingsDefaults";
import {
  pathLength,
  scheduleTrailSequence,
} from "../shared/utils/trailSequence";
import { chainTrailStates, mulberry32 } from "./chain";

const MAX_POOL_EVENTS = 100000;
const DOMAIN_FILTER_KEY = "relay-domain-filter";
const EDGE_MARGIN_FRACTION = 0.02;

const styles = {
  page: {
    position: "fixed",
    inset: 0,
    background: "#faf7f2",
    overflow: "hidden",
  } as React.CSSProperties,
  title: {
    position: "fixed",
    top: 16,
    left: 20,
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic" as const,
    fontWeight: 200,
    fontSize: "22px",
    color: "#3d3833",
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  status: {
    position: "fixed",
    top: 46,
    left: 20,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#8a8279",
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  panel: {
    position: "fixed",
    bottom: 16,
    right: 16,
    background: "#f5f0e8",
    border: "1px solid #e0dbd4",
    padding: "14px 16px",
    zIndex: 10,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#3d3833",
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    width: 230,
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  } as React.CSSProperties,
  slider: { width: 110 } as React.CSSProperties,
  button: {
    padding: "6px 10px",
    border: "1px solid #3d3833",
    background: "#3d3833",
    color: "#faf7f2",
    cursor: "pointer",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
  } as React.CSSProperties,
  input: {
    width: 110,
    padding: "4px 6px",
    border: "1px solid #e0dbd4",
    background: "#faf7f2",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#3d3833",
  } as React.CSSProperties,
};

const TrailRelay = () => {
  const [domainFilter, setDomainFilter] = useState<string>(
    () => localStorage.getItem(DOMAIN_FILTER_KEY) ?? "",
  );
  const [domainDraft, setDomainDraft] = useState(domainFilter);
  const { events, loading, deepening, error } = useCursorEventPool(
    domainFilter,
    MAX_POOL_EVENTS,
  );

  const [capMode, setCapMode] = useState<"trails" | "distance">("trails");
  const [maxTrails, setMaxTrails] = useState(20);
  const [maxDistanceKPx, setMaxDistanceKPx] = useState(50);
  const [kNearest, setKNearest] = useState(3);
  const [edgeFilter, setEdgeFilter] = useState(true);
  const [seed, setSeed] = useState(1);
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [pxPerSecond, setPxPerSecond] = useState(900);
  const [trailStyle, setTrailStyle] = useState<
    "straight" | "smooth" | "organic" | "chaotic"
  >("smooth");

  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    localStorage.setItem(DOMAIN_FILTER_KEY, domainFilter);
  }, [domainFilter]);

  const cursorSettings: CursorTrailSettings = useMemo(
    () => ({
      randomizeColors: false,
      filters: [],
      pidFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle,
      chaosIntensity: 1.0,
      trailAnimationMode: "natural",
      maxConcurrentTrails: 15,
      overlapFactor: 0.8,
      minGapBetweenTrails: 0.3,
      documentSpace: false,
    }),
    [trailStyle],
  );

  const { trailStates } = useCursorTrails(events, viewportSize, cursorSettings);

  const chained = useMemo(
    () =>
      chainTrailStates(trailStates, {
        maxTrails: capMode === "trails" ? maxTrails : Infinity,
        maxDistancePx:
          capMode === "distance" ? maxDistanceKPx * 1000 : Infinity,
        kNearest,
        edgeMarginFraction: edgeFilter ? EDGE_MARGIN_FRACTION : null,
        canvasSize: viewportSize,
        random: mulberry32(seed),
      }),
    [
      trailStates,
      capMode,
      maxTrails,
      maxDistanceKPx,
      kNearest,
      edgeFilter,
      viewportSize,
      seed,
    ],
  );

  // Handoff tightness (endpoint-to-next-origin gaps) plus total drawn
  // distance — the numbers to watch when tuning pool depth, k, and caps.
  const chainStats = useMemo(() => {
    if (chained.length === 0) return null;
    let gapTotal = 0;
    let gapMax = 0;
    let drawn = pathLength(chained[0].variedPoints);
    for (let i = 1; i < chained.length; i++) {
      const prev = chained[i - 1].variedPoints;
      const end = prev[prev.length - 1];
      const origin = chained[i].variedPoints[0];
      const hop = Math.hypot(origin.x - end.x, origin.y - end.y);
      gapTotal += hop;
      if (hop > gapMax) gapMax = hop;
      drawn += pathLength(chained[i].variedPoints);
    }
    return {
      gapAvg: chained.length > 1 ? gapTotal / (chained.length - 1) : 0,
      gapMax,
      drawnPx: drawn,
    };
  }, [chained]);

  const sequence = useMemo(
    () =>
      scheduleTrailSequence(chained, {
        pxPerSecond,
        minDurationMs: 500,
        maxDurationMs: 8000,
        gapMs: 150,
        overlap: 0,
        restMs: 3000,
      }),
    [chained, pxPerSecond],
  );

  const timeRange = useMemo(
    () => ({
      min: 0,
      max: sequence.totalDurationMs,
      duration: sequence.totalDurationMs,
    }),
    [sequence.totalDurationMs],
  );

  const animationSettings = useMemo(
    () => ({
      strokeWidth,
      trailOpacity: 0.85,
      animationSpeed,
      clickMinRadius: DEFAULT_SETTINGS.clickMinRadius,
      clickMaxRadius: DEFAULT_SETTINGS.clickMaxRadius,
      clickCoreRadius: DEFAULT_SETTINGS.clickCoreRadius,
      clickMinDuration: DEFAULT_SETTINGS.clickMinDuration,
      clickMaxDuration: DEFAULT_SETTINGS.clickMaxDuration,
      clickExpansionDuration: DEFAULT_SETTINGS.clickExpansionDuration,
      clickStrokeWidth: DEFAULT_SETTINGS.clickStrokeWidth,
      clickOpacity: DEFAULT_SETTINGS.clickOpacity,
      clickNumRings: DEFAULT_SETTINGS.clickNumRings,
      clickRingDelayMs: DEFAULT_SETTINGS.clickRingDelayMs,
      clickAnimationStopPoint: DEFAULT_SETTINGS.clickAnimationStopPoint,
      trailVisualStyle: "color",
    }),
    [strokeWidth, animationSpeed],
  );

  const handleReshuffle = useCallback(() => {
    setSeed((s) => s + 1);
  }, []);

  const handleDomainSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setDomainFilter(domainDraft.trim());
    },
    [domainDraft],
  );

  const capText =
    capMode === "trails"
      ? `${chained.length}/${maxTrails} trails`
      : `${chained.length} trails, ${Math.round((chainStats?.drawnPx ?? 0) / 1000)}k/${maxDistanceKPx}k px drawn`;
  const statusText = loading
    ? "loading cursor events..."
    : error
      ? error
      : `${capText} chained from ${trailStates.length} available` +
        (chainStats && chained.length > 1
          ? ` — handoff gap avg ${Math.round(chainStats.gapAvg)}px, max ${Math.round(chainStats.gapMax)}px`
          : "") +
        (deepening ? ` — deepening pool (${events.length} events)...` : "");

  return (
    <div style={styles.page}>
      <div style={styles.title}>trail relay</div>
      <div style={styles.status}>{statusText}</div>

      {!loading && !error && sequence.trailStates.length > 0 && (
        <AnimatedTrails
          key={`${seed}-${capMode}-${maxTrails}-${maxDistanceKPx}-${kNearest}-${edgeFilter}-${trailStyle}-${domainFilter}`}
          trailStates={sequence.trailStates}
          timeRange={timeRange}
          windowSize={sequence.trailStates.length}
          settings={animationSettings}
        />
      )}

      <div style={styles.panel}>
        <div style={styles.row}>
          <span>cap by</span>
          <select
            value={capMode}
            onChange={(e) => setCapMode(e.target.value as typeof capMode)}
            style={styles.input}
          >
            <option value="trails">trail count</option>
            <option value="distance">distance drawn</option>
          </select>
        </div>
        {capMode === "trails" ? (
          <div style={styles.row}>
            <span>trails: {maxTrails}</span>
            <input
              type="range"
              min={2}
              max={100}
              value={maxTrails}
              onChange={(e) => setMaxTrails(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
        ) : (
          <div style={styles.row}>
            <span>distance: {maxDistanceKPx}k</span>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={maxDistanceKPx}
              onChange={(e) => setMaxDistanceKPx(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
        )}
        <div style={styles.row}>
          <span>k nearest: {kNearest}</span>
          <input
            type="range"
            min={1}
            max={8}
            value={kNearest}
            onChange={(e) => setKNearest(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>speed: {animationSpeed.toFixed(1)}x</span>
          <input
            type="range"
            min={0.2}
            max={4}
            step={0.1}
            value={animationSpeed}
            onChange={(e) => setAnimationSpeed(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>pace: {pxPerSecond}px/s</span>
          <input
            type="range"
            min={200}
            max={3000}
            step={100}
            value={pxPerSecond}
            onChange={(e) => setPxPerSecond(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>stroke: {strokeWidth}</span>
          <input
            type="range"
            min={1}
            max={14}
            step={0.5}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>style</span>
          <select
            value={trailStyle}
            onChange={(e) =>
              setTrailStyle(e.target.value as typeof trailStyle)
            }
            style={styles.input}
          >
            <option value="straight">straight</option>
            <option value="smooth">smooth</option>
            <option value="organic">organic</option>
            <option value="chaotic">chaotic</option>
          </select>
        </div>
        <div style={styles.row}>
          <label>
            <input
              type="checkbox"
              checked={edgeFilter}
              onChange={(e) => setEdgeFilter(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            skip edge exits
          </label>
        </div>
        <form style={styles.row} onSubmit={handleDomainSubmit}>
          <span>domain</span>
          <input
            type="text"
            value={domainDraft}
            placeholder="all domains"
            onChange={(e) => setDomainDraft(e.target.value)}
            style={styles.input}
          />
        </form>
        <div style={{ ...styles.row, justifyContent: "flex-end" }}>
          <button style={styles.button} onClick={handleReshuffle}>
            reshuffle
          </button>
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<TrailRelay />);
