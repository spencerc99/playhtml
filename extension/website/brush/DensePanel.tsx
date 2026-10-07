// ABOUTME: Wide panel showing pastel trails plus production click ripples at real crowding.
// ABOUTME: Many real trails at their real page coordinates, so overlap is what is being judged.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trail } from "../shared/types";
import { pickDenseTrails } from "./sampleTrails";
import { renderCompareTiles, PASTEL_TILE_KEY } from "./compareRenderer";
import { effectiveWeight } from "./brushCatalog";
import { makeRippleMark, paintRipple, settledAt } from "./rippleOverlay";
import { PressureMode } from "./sketch";

const PANEL_WIDTH = 1200;
const PANEL_HEIGHT = 720;
const DEFAULT_TRAIL_COUNT = 80;

const styles = {
  layerHost: { position: "relative", width: "100%" } as React.CSSProperties,
  canvas: { display: "block", width: "100%", height: "auto" } as React.CSSProperties,
  overlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  } as React.CSSProperties,
  frame: { border: "1px solid #e0dbd4", background: "#faf7f2" } as React.CSSProperties,
  label: {
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#8a8279",
    padding: "6px 10px",
    borderTop: "1px solid #e0dbd4",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
  } as React.CSSProperties,
};

export const DensePanel = ({
  trails,
  weight,
  pressureMode,
  trailCount = DEFAULT_TRAIL_COUNT,
}: {
  trails: Trail[];
  weight: number;
  pressureMode: PressureMode;
  trailCount?: number;
}) => {
  const [ready, setReady] = useState(false);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const sample = useMemo(
    () => pickDenseTrails(trails, PANEL_WIDTH, PANEL_HEIGHT, trailCount),
    [trails, trailCount],
  );

  const clickCount = useMemo(
    () => sample.reduce((n, t) => n + t.clicks.length, 0),
    [sample],
  );

  // Pastel strokes, through the same single-WebGL-instance renderer the grid
  // uses. Clicks are excluded from the brush pass and drawn as ripples below.
  useEffect(() => {
    if (sample.length === 0 || !inkRef.current) return;
    setReady(false);
    const targets = new Map([[PASTEL_TILE_KEY, inkRef.current]]);
    const dispose = renderCompareTiles(
      [PASTEL_TILE_KEY],
      sample,
      targets,
      PANEL_WIDTH,
      PANEL_HEIGHT,
      { weight, pressureMode, clickStyle: "blot" },
      () => setReady(true),
    );
    return dispose;
  }, [sample, weight, pressureMode]);

  // Every real click, settled, layered above the ink.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    canvas.width = PANEL_WIDTH;
    canvas.height = PANEL_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    sample.forEach((trail, i) => {
      trail.clicks.forEach((click, j) => {
        const mark = makeRippleMark(
          `${i}-${j}`,
          click.x,
          click.y,
          trail.color,
          0,
        );
        paintRipple(ctx, mark, settledAt(mark));
      });
    });
  }, [sample]);

  return (
    <div style={styles.frame}>
      <div style={styles.layerHost}>
        <canvas
          ref={inkRef}
          width={PANEL_WIDTH}
          height={PANEL_HEIGHT}
          style={styles.canvas}
        />
        <canvas ref={overlayRef} style={styles.overlay} />
      </div>
      <div style={styles.label}>
        <span>
          pastel + current clicks — dense ({sample.length} trails,{" "}
          {clickCount} clicks{ready ? "" : ", rendering..."})
        </span>
        <span>weight {effectiveWeight("pastel", weight).toFixed(2)}</span>
      </div>
    </div>
  );
};
