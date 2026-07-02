// ABOUTME: Trail relay experiment — chains archive cursor trails end-to-origin into
// ABOUTME: one continuous journey, played back as a relay of strangers' gestures
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import ReactDOM from "react-dom/client";
import { AnimatedTrails } from "../shared/components/AnimatedTrails";
import {
  useCursorTrails,
  CursorTrailSettings,
} from "../shared/hooks/useCursorTrails";
import { useCursorEventPool } from "../shared/hooks/useCursorEventPool";
import { useChromeToggle } from "../shared/hooks/useChromeToggle";
import { DEFAULT_SETTINGS } from "../shared/components/settingsDefaults";
import {
  pathLength,
  scheduleTrailSequence,
} from "../shared/utils/trailSequence";
import { chainTrailStates, mulberry32 } from "./chain";

const MAX_POOL_EVENTS = 100000;
const DOMAIN_FILTER_KEY = "relay-domain-filter";
const EDGE_MARGIN_FRACTION = 0.02;
const MAX_TRAIL_LENGTH_KPX_MAX = 30;

interface JunctionDot {
  x: number;
  y: number;
  /** Timeline offset at which the relay reaches this dot. */
  fillMs: number;
}

/** Connect-the-dots layer: every junction is visible up front as a hollow
 * numbered dot, and fills in the moment the relay cursor arrives. Runs its
 * own clock with the same accumulation math as AnimatedTrails (delta times
 * current speed, looped over the cycle) so the two stay in step; give it the
 * same key as the animator so both clocks reset together. */
const DotsLayer = ({
  dots,
  durationMs,
  speed,
  showNumbers,
}: {
  dots: JunctionDot[];
  durationMs: number;
  speed: number;
  showNumbers: boolean;
}) => {
  const [filledCount, setFilledCount] = useState(0);
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    let frame: number;
    let last: number | null = null;
    let accumulated = 0;
    const tick = (timestamp: number) => {
      if (last === null) last = timestamp;
      accumulated += Math.min(250, timestamp - last) * speedRef.current;
      last = timestamp;
      const elapsed = accumulated % durationMs;
      let count = 0;
      while (count < dots.length && dots[count].fillMs <= elapsed) count++;
      setFilledCount((prev) => (prev === count ? prev : count));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dots, durationMs]);

  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    >
      {dots.map((dot, index) => {
        const filled = index < filledCount;
        return (
          <g key={index}>
            <circle
              cx={dot.x}
              cy={dot.y}
              r={filled ? 6 : 4.5}
              fill={filled ? "#3d3833" : "#faf7f2"}
              stroke={filled ? "#3d3833" : "#8a8279"}
              strokeWidth={1.5}
              style={{ transition: "r 150ms ease, fill 150ms ease" }}
            />
            {showNumbers && (
              <text
                x={dot.x + 9}
                y={dot.y - 7}
                fontFamily="'Martian Mono', monospace"
                fontSize={9}
                fill={filled ? "#3d3833" : "#8a8279"}
              >
                {index + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

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
  const chromeHidden = useChromeToggle();
  const [domainFilter, setDomainFilter] = useState<string>(
    () => localStorage.getItem(DOMAIN_FILTER_KEY) ?? "",
  );
  const [domainDraft, setDomainDraft] = useState(domainFilter);
  const { events, loading, deepening, error } = useCursorEventPool(
    domainFilter,
    MAX_POOL_EVENTS,
  );

  const [capMode, setCapMode] = useState<"trails" | "distance">("trails");
  const [maxTrails, setMaxTrails] = useState(9);
  const [maxDistanceKPx, setMaxDistanceKPx] = useState(50);
  const [kNearest, setKNearest] = useState(3);
  const [maxTrailLengthKPx, setMaxTrailLengthKPx] = useState(8);
  const [edgeFilter, setEdgeFilter] = useState(true);
  const [showDots, setShowDots] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);
  const [minDotDistancePx, setMinDotDistancePx] = useState(150);
  const [beatMs, setBeatMs] = useState(400);
  const [seed, setSeed] = useState(1);
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [pxPerSecond, setPxPerSecond] = useState(600);
  const [trailStyle, setTrailStyle] = useState<
    "straight" | "smooth" | "organic" | "chaotic"
  >("chaotic");

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
        maxTrailLengthPx:
          maxTrailLengthKPx >= MAX_TRAIL_LENGTH_KPX_MAX
            ? Infinity
            : maxTrailLengthKPx * 1000,
        minDotDistancePx,
        canvasSize: viewportSize,
        random: mulberry32(seed),
      }),
    [
      trailStates,
      capMode,
      maxTrails,
      maxDistanceKPx,
      kNearest,
      maxTrailLengthKPx,
      edgeFilter,
      minDotDistancePx,
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
        gapMs: beatMs,
        overlap: 0,
        restMs: 3000,
      }),
    [chained, pxPerSecond, beatMs],
  );

  // Junction dots: the seed's origin plus every trail's arrival point, each
  // stamped with the timeline offset at which the relay reaches it.
  const junctionDots = useMemo((): JunctionDot[] => {
    const list: JunctionDot[] = [];
    sequence.trailStates.forEach((state, index) => {
      if (index === 0) {
        const origin = state.variedPoints[0];
        list.push({ x: origin.x, y: origin.y, fillMs: state.startOffsetMs });
      }
      const end = state.variedPoints[state.variedPoints.length - 1];
      list.push({
        x: end.x,
        y: end.y,
        fillMs: state.startOffsetMs + state.durationMs,
      });
    });
    return list;
  }, [sequence]);

  // A synthetic click at the very end of each trail gives every handoff the
  // same ripple a real click gets — the "connected a dot" moment.
  const playbackTrailStates = useMemo(
    () =>
      sequence.trailStates.map((state) => {
        const end = state.variedPoints[state.variedPoints.length - 1];
        return {
          ...state,
          clicksWithProgress: [
            ...state.clicksWithProgress,
            { x: end.x, y: end.y, ts: 0, progress: 0.999 },
          ],
        };
      }),
    [sequence],
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

  // One key for both the animator and the dots layer so their clocks reset
  // together whenever the chain or pacing changes.
  const playbackKey = `${seed}-${capMode}-${maxTrails}-${maxDistanceKPx}-${kNearest}-${maxTrailLengthKPx}-${edgeFilter}-${minDotDistancePx}-${beatMs}-${trailStyle}-${domainFilter}`;

  return (
    <div style={styles.page}>
      {!chromeHidden && <div style={styles.title}>trail relay</div>}
      {!chromeHidden && <div style={styles.status}>{statusText}</div>}

      {!loading && !error && sequence.trailStates.length > 0 && (
        <>
          <AnimatedTrails
            key={playbackKey}
            trailStates={playbackTrailStates}
            timeRange={timeRange}
            windowSize={playbackTrailStates.length}
            settings={animationSettings}
          />
          {showDots && (
            <DotsLayer
              key={`dots-${playbackKey}`}
              dots={junctionDots}
              durationMs={timeRange.duration}
              speed={animationSpeed}
              showNumbers={showNumbers}
            />
          )}
        </>
      )}

      {!chromeHidden && (
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
            <span>
              max trail:{" "}
              {maxTrailLengthKPx >= MAX_TRAIL_LENGTH_KPX_MAX
                ? "off"
                : `${maxTrailLengthKPx}k`}
            </span>
            <input
              type="range"
              min={1}
              max={MAX_TRAIL_LENGTH_KPX_MAX}
              value={maxTrailLengthKPx}
              onChange={(e) => setMaxTrailLengthKPx(Number(e.target.value))}
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
            <span>beat: {beatMs}ms</span>
            <input
              type="range"
              min={0}
              max={1500}
              step={50}
              value={beatMs}
              onChange={(e) => setBeatMs(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
          <div style={styles.row}>
            <label>
              <input
                type="checkbox"
                checked={showDots}
                onChange={(e) => setShowDots(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              dots
            </label>
            <label>
              <input
                type="checkbox"
                checked={showNumbers}
                onChange={(e) => setShowNumbers(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              numbers
            </label>
          </div>
          <div style={styles.row}>
            <span>dot spacing: {minDotDistancePx}px</span>
            <input
              type="range"
              min={0}
              max={400}
              step={10}
              value={minDotDistancePx}
              onChange={(e) => setMinDotDistancePx(Number(e.target.value))}
              style={styles.slider}
            />
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
      )}
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<TrailRelay />);
