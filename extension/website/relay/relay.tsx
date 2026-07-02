// ABOUTME: Trail relay experiment — chains archive cursor trails end-to-origin into
// ABOUTME: one continuous journey, played back as a relay of strangers' gestures
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent } from "../shared/types";
import { AnimatedTrails } from "../shared/components/AnimatedTrails";
import {
  useCursorTrails,
  CursorTrailSettings,
} from "../shared/hooks/useCursorTrails";
import { DEFAULT_SETTINGS } from "../shared/components/settingsDefaults";
import { RECENT_EVENTS_URL } from "../shared/config";
import { scheduleTrailSequence } from "../shared/utils/trailSequence";
import { chainTrailStates, mulberry32 } from "./chain";

const FETCH_LIMIT = 20000;
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
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>(
    () => localStorage.getItem(DOMAIN_FILTER_KEY) ?? "",
  );
  const [domainDraft, setDomainDraft] = useState(domainFilter);

  const [maxTrails, setMaxTrails] = useState(20);
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      type: "cursor",
      limit: String(FETCH_LIMIT),
    });
    if (domainFilter) params.set("domain", domainFilter);

    fetch(`${RECENT_EVENTS_URL}?${params}`)
      .then((response) => {
        if (!response.ok)
          throw new Error(`Failed to fetch cursor events: ${response.status}`);
        return response.json();
      })
      .then((data: CollectionEvent[]) => {
        if (!cancelled) setEvents(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to fetch");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
        maxTrails,
        kNearest,
        edgeMarginFraction: edgeFilter ? EDGE_MARGIN_FRACTION : null,
        canvasSize: viewportSize,
        random: mulberry32(seed),
      }),
    [trailStates, maxTrails, kNearest, edgeFilter, viewportSize, seed],
  );

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

  const statusText = loading
    ? "loading cursor events..."
    : error
      ? error
      : `${chained.length}/${maxTrails} trails chained from ${trailStates.length} available`;

  return (
    <div style={styles.page}>
      <div style={styles.title}>trail relay</div>
      <div style={styles.status}>{statusText}</div>

      {!loading && !error && sequence.trailStates.length > 0 && (
        <AnimatedTrails
          key={`${seed}-${maxTrails}-${kNearest}-${edgeFilter}-${trailStyle}-${domainFilter}`}
          trailStates={sequence.trailStates}
          timeRange={timeRange}
          windowSize={sequence.trailStates.length}
          settings={animationSettings}
        />
      )}

      <div style={styles.panel}>
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
