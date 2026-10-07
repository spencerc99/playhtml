// ABOUTME: Side-by-side sheet showing one fixed sample of real trails drawn with every tool.
// ABOUTME: Tile one is the production SVG/perfect-freehand renderer; the rest are p5.brush brushes.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trail } from "../shared/types";
import { buildFreehandPathSegment } from "../shared/utils/trailAnimation";
import { makeRippleMark, paintRipple, settledAt } from "./rippleOverlay";
import { TRAIL_BRUSHES, effectiveWeight } from "./brushCatalog";
import { pickSampleTrails, SampleTrail } from "./sampleTrails";
import { DensePanel } from "./DensePanel";
import {
  renderCompareTiles,
  CompareTileResult,
  PASTEL_TILE_KEY,
} from "./compareRenderer";
import { ClickStyle, PressureMode } from "./sketch";

// Two columns on a ~1300px viewport, one on anything narrower. Tiles this size
// are what make a brush's grain legible at all.
const TILE_WIDTH = 600;
const TILE_HEIGHT = 420;

/** Production trail defaults, matched to the live portrait's settings. */
const PRODUCTION_STROKE_WIDTH = 5;
const PRODUCTION_TRAIL_OPACITY = 0.7;

const styles = {
  page: {
    minHeight: "100vh",
    background: "#faf7f2",
    color: "#3d3833",
    fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
    padding: "20px 24px 60px",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  heading: { fontSize: "18px", margin: "0 0 4px" } as React.CSSProperties,
  sub: {
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#8a8279",
    margin: "0 0 16px",
  } as React.CSSProperties,
  controls: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "18px",
    background: "#f5f0e8",
    border: "1px solid #e0dbd4",
    padding: "12px 16px",
    marginBottom: 20,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
  } as React.CSSProperties,
  control: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  select: {
    padding: "4px 6px",
    border: "1px solid #e0dbd4",
    background: "#faf7f2",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#3d3833",
  } as React.CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_WIDTH}px, 1fr))`,
    gap: "18px",
  } as React.CSSProperties,
  tile: {
    border: "1px solid #e0dbd4",
    background: "#faf7f2",
  } as React.CSSProperties,
  tileLabel: {
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#8a8279",
    padding: "6px 8px",
    borderTop: "1px solid #e0dbd4",
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
  } as React.CSSProperties,
  canvas: {
    display: "block",
    width: "100%",
    height: "auto",
  } as React.CSSProperties,
  // The ripple overlay sits above the ink in the same box. Both layers are
  // authored at tile resolution and scaled by the same CSS width, so they stay
  // in register regardless of the display's pixel ratio.
  layerHost: { position: "relative" } as React.CSSProperties,
  overlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  } as React.CSSProperties,
  error: { color: "#b4331f" } as React.CSSProperties,
  denseSection: { marginTop: 32 } as React.CSSProperties,
  denseHeading: {
    fontSize: "14px",
    fontWeight: 600,
    margin: "0 0 10px",
  } as React.CSSProperties,
  link: {
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#5b8db8",
  } as React.CSSProperties,
};

/**
 * Paint every sample click as a settled production ripple onto a 2D canvas.
 * Shared by the SVG tile's overlay and the pastel tile, so the two show the
 * exact same click marks and can be compared directly.
 */
function useRippleOverlay(sample: SampleTrail[]) {
  return useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      canvas.width = TILE_WIDTH;
      canvas.height = TILE_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, TILE_WIDTH, TILE_HEIGHT);
      sample.forEach((trail, i) => {
        trail.clicks.forEach((click, j) => {
          const mark = makeRippleMark(
            `${i}-${j}`,
            click.x,
            click.y,
            trail.color,
            0,
          );
          // Drawn at the moment every ring has finished expanding, which is
          // the settled residue the replay leaves behind.
          paintRipple(ctx, mark, settledAt(mark));
        });
      });
    },
    [sample],
  );
}

/** The production renderer's look: filled freehand outlines plus ripple rings. */
const ProductionTile = ({ sample }: { sample: SampleTrail[] }) => {
  const paintOverlay = useRippleOverlay(sample);
  return (
    <div style={styles.layerHost}>
      <svg
        width={TILE_WIDTH}
        height={TILE_HEIGHT}
        viewBox={`0 0 ${TILE_WIDTH} ${TILE_HEIGHT}`}
        style={styles.canvas}
      >
        <rect width={TILE_WIDTH} height={TILE_HEIGHT} fill="#faf7f2" />
        {sample.map((trail, i) => (
          <path
            key={i}
            d={buildFreehandPathSegment(
              trail.points,
              0,
              trail.points.length - 1,
              PRODUCTION_STROKE_WIDTH,
              true,
            )}
            fill={trail.color}
            opacity={PRODUCTION_TRAIL_OPACITY}
          />
        ))}
      </svg>
      <canvas ref={paintOverlay} style={styles.overlay} />
    </div>
  );
};

/**
 * Pastel brush trails with the production click ripples baked in STROKE ORDER,
 * so a trail drawn after a click partly covers it. The ripples are stamped by
 * the renderer between trails rather than layered over the finished tile.
 */
const PastelTile = ({
  canvasRef,
}: {
  canvasRef: (el: HTMLCanvasElement | null) => void;
}) => (
  <canvas
    ref={canvasRef}
    width={TILE_WIDTH}
    height={TILE_HEIGHT}
    style={styles.canvas}
  />
);

export const CompareView = ({
  trails,
  sourceLabel,
  denseOnly = false,
}: {
  trails: Trail[];
  sourceLabel: string;
  /** `?view=dense` shows only the crowded panel, full width. */
  denseOnly?: boolean;
}) => {
  // Matches the replay page's tuned pastel default.
  const [weight, setWeight] = useState(0.5);
  const [pressureMode, setPressureMode] = useState<PressureMode>("speed");
  const [clickStyle, setClickStyle] = useState<ClickStyle>("blot");
  const [results, setResults] = useState<CompareTileResult[]>([]);

  const sample = useMemo(
    () => pickSampleTrails(trails, TILE_WIDTH, TILE_HEIGHT),
    [trails],
  );

  const canvasRefs = useRef(new Map<string, HTMLCanvasElement>());

  useEffect(() => {
    if (denseOnly || sample.length === 0) return;
    const dispose = renderCompareTiles(
      // The pastel tile draws the same brush but takes its clicks from the
      // ripple overlay instead, so it is rendered as its own strokes-only pass.
      [PASTEL_TILE_KEY, ...TRAIL_BRUSHES],
      sample,
      canvasRefs.current,
      TILE_WIDTH,
      TILE_HEIGHT,
      { weight, pressureMode, clickStyle },
      // Results land in a ref-backed state update only when the run finishes,
      // so the tile elements are not rebuilt while tiles are still being
      // copied into them.
      (r) => setResults(r),
    );
    return dispose;
  }, [denseOnly, sample, weight, pressureMode, clickStyle]);

  const resultFor = (brushName: string) =>
    results.find((r) => r.brushName === brushName);

  if (denseOnly) {
    return (
      <div style={styles.page}>
        <h1 style={styles.heading}>cursor ink — pastel + current clicks, dense</h1>
        <p style={styles.sub}>
          Real trails at their real page positions, so the overlap is genuine.{" "}
          {sourceLabel} ·{" "}
          <a href="?view=compare" style={styles.link}>
            tool comparison
          </a>{" "}
          · <a href="./" style={styles.link}>back to the replay</a>
        </p>
        <DensePanel
          trails={trails}
          weight={weight}
          pressureMode={pressureMode}
        />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>cursor ink — tool comparison</h1>
      <p style={styles.sub}>
        {sample.length} trails, identical sample and transform in every tile.{" "}
        {sourceLabel} · <a href="./" style={styles.link}>back to the replay</a> ·{" "}
        <a href="?view=dense" style={styles.link}>
          dense pastel panel
        </a>
      </p>

      <div style={styles.controls}>
        <label style={styles.control}>
          weight {weight.toFixed(1)}
          <input
            type="range"
            min={0.2}
            max={4}
            step={0.1}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>
        <label style={styles.control}>
          pressure
          <select
            value={pressureMode}
            onChange={(e) => setPressureMode(e.target.value as PressureMode)}
            style={styles.select}
          >
            <option value="constant">constant</option>
            <option value="speed">from speed</option>
          </select>
        </label>
        <label style={styles.control}>
          click
          <select
            value={clickStyle}
            onChange={(e) => setClickStyle(e.target.value as ClickStyle)}
            style={styles.select}
          >
            <option value="spray">spray dab</option>
            <option value="hatch">hatched circle</option>
            <option value="blot">watercolor blot</option>
          </select>
        </label>
        <span style={{ color: "#8a8279" }}>
          {results.length} / {TRAIL_BRUSHES.length + 1} brushes rendered
        </span>
      </div>

      <div style={styles.grid}>
        <div style={styles.tile}>
          <ProductionTile sample={sample} />
          <div style={styles.tileLabel}>
            <span>current (SVG / perfect-freehand)</span>
            <span>size {PRODUCTION_STROKE_WIDTH}</span>
          </div>
        </div>

        <div style={styles.tile}>
          <PastelTile
            canvasRef={(el) => {
              if (el) canvasRefs.current.set(PASTEL_TILE_KEY, el);
            }}
          />
          <div style={styles.tileLabel}>
            <span>pastel + current clicks</span>
            <span>weight {effectiveWeight("pastel", weight).toFixed(2)}</span>
          </div>
        </div>

        {TRAIL_BRUSHES.map((brushName) => {
          const result = resultFor(brushName);
          return (
            <div key={brushName} style={styles.tile}>
              <canvas
                ref={(el) => {
                  // Only ever add. React calls the cleanup form with null on
                  // every re-render, and deleting there would empty the map
                  // that the in-flight render is still copying tiles into.
                  if (el) canvasRefs.current.set(brushName, el);
                }}
                width={TILE_WIDTH}
                height={TILE_HEIGHT}
                style={styles.canvas}
              />
              <div style={styles.tileLabel}>
                <span>{brushName}</span>
                <span style={result?.error ? styles.error : undefined}>
                  {result?.error
                    ? result.error
                    : `weight ${effectiveWeight(brushName, weight).toFixed(2)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Rendered after the grid finishes: both use their own p5/WebGL
          instance, and running them at once makes each one slower to settle. */}
      {results.length > TRAIL_BRUSHES.length && (
        <div style={styles.denseSection}>
          <h2 style={styles.denseHeading}>
            pastel + current clicks, at real density
          </h2>
          <DensePanel
            trails={trails}
            weight={weight}
            pressureMode={pressureMode}
          />
        </div>
      )}
    </div>
  );
};
