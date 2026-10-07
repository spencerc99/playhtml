// ABOUTME: p5.brush ink experiment — replays real cursor trails as marks that accumulate
// ABOUTME: permanently, with a control panel for brush, click style, pressure and speed.

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import * as brush from "p5.brush";
import {
  useCursorTrails,
  CursorTrailSettings,
} from "../shared/hooks/useCursorTrails";
import { useCursorEventPool } from "../shared/hooks/useCursorEventPool";
import {
  createBrushSketch,
  BrushSettings,
  BrushStats,
  ClickStyle,
  PressureMode,
} from "./sketch";
import { generateSyntheticTrails } from "./syntheticTrails";
import { TRAIL_BRUSHES, effectiveWeight } from "./brushCatalog";
import { CompareView } from "./CompareView";
import { createRippleLayer, RippleLayer } from "./rippleOverlay";
import { CursorLayer, CursorLayerHandle } from "./CursorLayer";

const MAX_POOL_EVENTS = 40000;
const SYNTHETIC_TRAIL_COUNT = 24;

const CLICK_STYLES: Array<{ value: ClickStyle; label: string }> = [
  { value: "ripple", label: "current ripples" },
  { value: "spray", label: "spray dab" },
  { value: "hatch", label: "hatched circle" },
  { value: "blot", label: "watercolor blot" },
];

const styles = {
  page: {
    position: "fixed",
    inset: 0,
    background: "#faf7f2",
    overflow: "hidden",
  } as React.CSSProperties,
  canvasHost: { position: "absolute", inset: 0 } as React.CSSProperties,
  // Stacked directly above the p5 canvas and inert to the pointer, so the
  // ripples read as part of the same drawing.
  rippleOverlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: 1,
  } as React.CSSProperties,
  // Readouts sit over accumulating ink, so each carries a translucent linen
  // backing to stay legible once the canvas fills.
  title: {
    position: "fixed",
    top: 16,
    left: 20,
    fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
    fontSize: "15px",
    color: "#3d3833",
    background: "rgba(250, 247, 242, 0.85)",
    padding: "2px 8px",
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  source: {
    position: "fixed",
    top: 44,
    left: 20,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#8a8279",
    background: "rgba(250, 247, 242, 0.85)",
    padding: "3px 8px",
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  perf: {
    position: "fixed",
    bottom: 16,
    left: 20,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    lineHeight: 1.7,
    color: "#8a8279",
    background: "rgba(250, 247, 242, 0.85)",
    padding: "6px 10px",
    zIndex: 10,
    pointerEvents: "none",
    whiteSpace: "pre" as const,
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
    width: 250,
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  } as React.CSSProperties,
  select: {
    width: 120,
    padding: "4px 6px",
    border: "1px solid #e0dbd4",
    background: "#faf7f2",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#3d3833",
  } as React.CSSProperties,
  slider: { width: 120 } as React.CSSProperties,
  error: {
    marginTop: 6,
    maxWidth: 320,
    color: "#b4331f",
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,
  compareLink: {
    position: "fixed",
    top: 18,
    right: 16,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#5b8db8",
    background: "rgba(250, 247, 242, 0.85)",
    padding: "4px 8px",
    zIndex: 10,
  } as React.CSSProperties,
  button: {
    flex: 1,
    padding: "6px 8px",
    border: "1px solid #e0dbd4",
    background: "#faf7f2",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#3d3833",
    cursor: "pointer",
  } as React.CSSProperties,
};

/** `?view=compare` opens the tool comparison sheet, `?view=dense` the crowded
 * pastel panel on its own. Anything else is the replay. */
function parseView(): "replay" | "compare" | "dense" {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "compare") return "compare";
  if (view === "dense") return "dense";
  return "replay";
}

const BrushInk = () => {
  const { events, loading, error } = useCursorEventPool("", MAX_POOL_EVENTS);
  const view = useMemo(parseView, []);
  const compare = view !== "replay";

  const [viewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  const [trailBrush, setTrailBrush] = useState("pastel");
  const [clickStyle, setClickStyle] = useState<ClickStyle>("ripple");
  // Spencer's tuned pastel setting.
  const [strokeWeight, setStrokeWeight] = useState(2);
  const [speed, setSpeed] = useState(6);
  const [maxConcurrentTrails, setMaxConcurrentTrails] = useState(6);
  const [pressureMode, setPressureMode] = useState<PressureMode>("speed");
  const [wetHead, setWetHead] = useState(true);
  const [stats, setStats] = useState<BrushStats | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);

  // brush.box() is the runtime truth about which brushes exist; fall back to
  // the curated catalog order if the library answers before registering.
  const brushNames = useMemo(() => {
    const names = brush.box();
    return names.length > 0 ? names : [...TRAIL_BRUSHES];
  }, []);

  const cursorSettings: CursorTrailSettings = useMemo(
    () => ({
      randomizeColors: false,
      filters: [],
      pidFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle: "straight",
      chaosIntensity: 1,
      trailAnimationMode: "natural",
      maxConcurrentTrails: 15,
      overlapFactor: 0.8,
      minGapBetweenTrails: 0.3,
      documentSpace: false,
    }),
    [],
  );

  const { trails: archiveTrails } = useCursorTrails(
    events,
    viewportSize,
    cursorSettings,
  );

  // The archive is the real source. Synthetic trails stand in only when the
  // fetch failed, and the page says so rather than pretending otherwise.
  const usingSynthetic = !loading && (error !== null || archiveTrails.length === 0);

  const trails = useMemo(() => {
    if (!usingSynthetic) return archiveTrails;
    return generateSyntheticTrails(
      SYNTHETIC_TRAIL_COUNT,
      viewportSize.width,
      viewportSize.height,
    );
  }, [usingSynthetic, archiveTrails, viewportSize]);

  const settingsRef = useRef<BrushSettings>({
    trailBrush,
    clickStyle,
    strokeWeight,
    speed,
    maxConcurrentTrails,
    pressureMode,
    wetHead,
  });
  useEffect(() => {
    settingsRef.current = {
      trailBrush,
      clickStyle,
      strokeWeight,
      speed,
      maxConcurrentTrails,
      pressureMode,
      wetHead,
    };
  }, [trailBrush, clickStyle, strokeWeight, speed, maxConcurrentTrails, pressureMode, wetHead]);

  const hostRef = useRef<HTMLDivElement>(null);
  const sketchRef = useRef<ReturnType<typeof createBrushSketch> | null>(null);
  const rippleCanvasRef = useRef<HTMLCanvasElement>(null);
  const rippleLayerRef = useRef<RippleLayer | null>(null);
  const cursorLayerRef = useRef<CursorLayerHandle>(null);

  // The ripple layer outlives sketch restarts, so clicks keep landing on the
  // same accumulating overlay while the ink underneath replays.
  useEffect(() => {
    if (compare || !rippleCanvasRef.current) return;
    const layer = createRippleLayer(rippleCanvasRef.current, (x, y, color) =>
      sketchRef.current?.bakeRipple(x, y, color),
    );
    rippleLayerRef.current = layer;
    const onResize = () => layer.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      rippleLayerRef.current = null;
      layer.stop();
    };
  }, [compare]);

  // Only the data rebuilds the sketch. Brush, click style, weight, speed and
  // pressure are read from settingsRef every frame, so changing them keeps the
  // accumulated ink and simply switches the tool that new ink is drawn with.
  useEffect(() => {
    if (compare || !hostRef.current || trails.length === 0) return;
    const instance = createBrushSketch(
      trails,
      settingsRef,
      hostRef.current,
      setStats,
      setDrawError,
      (x, y, color) => rippleLayerRef.current?.add(x, y, color),
      (heads) => cursorLayerRef.current?.update(heads),
    );
    sketchRef.current = instance;
    return () => {
      sketchRef.current = null;
      instance.remove();
    };
  }, [trails, compare]);

  const sourceLabel = loading
    ? "loading cursor archive..."
    : usingSynthetic
      ? `source: SYNTHETIC fallback (${error ?? "archive returned no trails"})`
      : `source: worker archive — ${events.length} events, ${trails.length} trails`;

  if (compare) {
    return (
      <CompareView
        trails={trails}
        sourceLabel={sourceLabel}
        denseOnly={view === "dense"}
      />
    );
  }

  return (
    <div style={styles.page}>
      <div ref={hostRef} style={styles.canvasHost} />
      <canvas ref={rippleCanvasRef} style={styles.rippleOverlay} />
      <CursorLayer ref={cursorLayerRef} />
      <div style={styles.title}>cursor ink</div>
      <div style={styles.source}>{sourceLabel}</div>
      <a href="?view=compare" style={styles.compareLink}>
        compare tools
      </a>

      {stats && (
        <div style={styles.perf}>
          {`fps        ${stats.fps.toFixed(1)}
draw       ${stats.drawMs.toFixed(2)} ms
points     ${stats.pointsDrawn}
active     ${stats.activeTrails}
finished   ${stats.finishedTrails} / ${stats.totalTrails}
${trailBrush} ~${stats.strokeWidthPx.toFixed(1)}px (w ${stats.appliedWeight.toFixed(2)})\nwet        ${stats.wetMs.toFixed(2)} ms`}
          {drawError && <div style={styles.error}>{drawError}</div>}
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.row}>
          <span>brush</span>
          <select
            value={trailBrush}
            onChange={(e) => setTrailBrush(e.target.value)}
            style={styles.select}
          >
            {brushNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.row}>
          <span>click</span>
          <select
            value={clickStyle}
            onChange={(e) => setClickStyle(e.target.value as ClickStyle)}
            style={styles.select}
          >
            {CLICK_STYLES.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.row}>
          <span>
            weight {strokeWeight.toFixed(1)} (
            {effectiveWeight(trailBrush, strokeWeight).toFixed(2)})
          </span>
          <input
            type="range"
            min={0.2}
            max={4}
            step={0.1}
            value={strokeWeight}
            onChange={(e) => setStrokeWeight(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.row}>
          <span>speed {speed}x</span>
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.row}>
          <span>concurrent {maxConcurrentTrails}</span>
          <input
            type="range"
            min={1}
            max={24}
            step={1}
            value={maxConcurrentTrails}
            onChange={(e) => setMaxConcurrentTrails(Number(e.target.value))}
            style={styles.slider}
          />
        </div>

        <div style={styles.row}>
          <span>pressure</span>
          <select
            value={pressureMode}
            onChange={(e) => setPressureMode(e.target.value as PressureMode)}
            style={styles.select}
          >
            <option value="constant">constant</option>
            <option value="speed">from speed</option>
          </select>
        </div>

        <div style={styles.row}>
          <span>wet head</span>
          <select
            value={wetHead ? "on" : "off"}
            onChange={(e) => setWetHead(e.target.value === "on")}
            style={styles.select}
          >
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </div>

        <div style={styles.row}>
          <button
            type="button"
            style={styles.button}
            onClick={() => {
              rippleLayerRef.current?.clear();
              sketchRef.current?.restart();
            }}
          >
            restart
          </button>
          <button
            type="button"
            style={styles.button}
            onClick={() => sketchRef.current?.savePng()}
          >
            save png
          </button>
        </div>
      </div>
    </div>
  );
};

// Vite's HMR re-runs this module against the same container. Caching the root
// keeps React from creating a second one over the first, which warns and leaves
// two trees mounted on the same node.
const container = document.getElementById("reactContent") as HTMLElement & {
  __brushRoot?: ReactDOM.Root;
};
container.__brushRoot ??= ReactDOM.createRoot(container);
container.__brushRoot.render(<BrushInk />);
