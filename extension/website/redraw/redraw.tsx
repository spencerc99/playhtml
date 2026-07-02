// ABOUTME: Cursor redraw experiment — draws an uploaded image out of real cursor
// ABOUTME: trails, either as a mosaic of rigid gestures or by warping trails onto edges
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import { TrailState } from "../shared/types";
import { AnimatedTrails } from "../shared/components/AnimatedTrails";
import {
  useCursorTrails,
  CursorTrailSettings,
} from "../shared/hooks/useCursorTrails";
import { useCursorEventPool } from "../shared/hooks/useCursorEventPool";
import { DEFAULT_SETTINGS } from "../shared/components/settingsDefaults";
import { scheduleTrailSequence } from "../shared/utils/trailSequence";
import { dilateMask, extractStrokes, loadImageData, Point } from "./image";
import { LibraryItem, inPlaceTrails, mosaicTrails, warpTrails } from "./draw";

const MAX_POOL_EVENTS = 100000;
const IMAGE_MAX_SIZE = 640;
const LIBRARY_CHUNK_POINTS = 120;
const LIBRARY_MIN_CHUNK_POINTS = 8;
const LIBRARY_MAX_ITEMS = 1500;
const CANVAS_FIT = 0.85;

type Mode = "mosaic" | "warp" | "inplace";

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
  dropPrompt: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "12px",
    color: "#8a8279",
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
    width: 240,
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  } as React.CSSProperties,
  slider: { width: 110 } as React.CSSProperties,
  modeButton: (active: boolean) =>
    ({
      flex: 1,
      padding: "6px 0",
      border: "1px solid #3d3833",
      background: active ? "#3d3833" : "#f5f0e8",
      color: active ? "#faf7f2" : "#3d3833",
      cursor: "pointer",
      fontFamily: "'Martian Mono', monospace",
      fontSize: "10px",
      textTransform: "uppercase" as const,
      letterSpacing: "1px",
    }) as React.CSSProperties,
};

const CursorRedraw = () => {
  const { events, loading, deepening, error: poolError } = useCursorEventPool(
    "",
    MAX_POOL_EVENTS,
  );
  const [error, setError] = useState<string | null>(null);

  const [image, setImage] = useState<{
    imageData: ImageData;
    objectUrl: string;
  } | null>(null);

  const [mode, setMode] = useState<Mode>("mosaic");
  const [threshold, setThreshold] = useState(60);
  const [maxStrokes, setMaxStrokes] = useState(160);
  const [allowRotation, setAllowRotation] = useState(false);
  const [warpStrength, setWarpStrength] = useState(0.85);
  const [corridor, setCorridor] = useState(8);
  const [strokeWidth, setStrokeWidth] = useState(3.5);
  const [pxPerSecond, setPxPerSecond] = useState(1400);
  const [overlap, setOverlap] = useState(0.85);
  const [showUnderlay, setShowUnderlay] = useState(true);

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

  const handleFile = useCallback((file: File) => {
    loadImageData(file, IMAGE_MAX_SIZE)
      .then((loaded) => {
        setImage((prev) => {
          if (prev) URL.revokeObjectURL(prev.objectUrl);
          return loaded;
        });
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load image"),
      );
  }, []);

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith("image/")) handleFile(file);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
  }, [handleFile]);

  const cursorSettings: CursorTrailSettings = useMemo(
    () => ({
      randomizeColors: false,
      filters: [],
      pidFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      // Straight keeps the genuine gesture shapes for matching.
      trailStyle: "straight",
      chaosIntensity: 1.0,
      trailAnimationMode: "natural",
      maxConcurrentTrails: 15,
      overlapFactor: 0.8,
      minGapBetweenTrails: 0.3,
      documentSpace: false,
    }),
    [],
  );

  const { trailStates } = useCursorTrails(events, viewportSize, cursorSettings);

  // Split real trails into gesture chunks — the drawing library.
  const library = useMemo((): LibraryItem[] => {
    const items: LibraryItem[] = [];
    for (const state of trailStates) {
      const points = state.trail.points;
      for (let start = 0; start < points.length; start += LIBRARY_CHUNK_POINTS) {
        const chunk = points.slice(start, start + LIBRARY_CHUNK_POINTS);
        if (chunk.length < LIBRARY_MIN_CHUNK_POINTS) continue;
        items.push({
          points: chunk.map((p) => ({ x: p.x, y: p.y })),
          color: state.trail.color,
          id: `${state.trail.id}-${start}`,
        });
        if (items.length >= LIBRARY_MAX_ITEMS) return items;
      }
    }
    return items;
  }, [trailStates]);

  // Fit the image into the viewport and express strokes in canvas pixels.
  const fit = useMemo(() => {
    if (!image) return null;
    const { width, height } = image.imageData;
    const scale = Math.min(
      (viewportSize.width * CANVAS_FIT) / width,
      (viewportSize.height * CANVAS_FIT) / height,
    );
    return {
      scale,
      offsetX: (viewportSize.width - width * scale) / 2,
      offsetY: (viewportSize.height - height * scale) / 2,
      width: width * scale,
      height: height * scale,
    };
  }, [image, viewportSize]);

  const imageStrokes = useMemo(() => {
    if (!image) return null;
    return extractStrokes(image.imageData, threshold, maxStrokes);
  }, [image, threshold, maxStrokes]);

  const canvasStrokes = useMemo((): { strokes: Point[][] } | null => {
    if (!imageStrokes || !fit) return null;
    const toCanvas = (p: Point): Point => ({
      x: fit.offsetX + p.x * fit.scale,
      y: fit.offsetY + p.y * fit.scale,
    });
    return { strokes: imageStrokes.strokes.map((s) => s.map(toCanvas)) };
  }, [imageStrokes, fit]);

  // Full untransformed trails at their real viewport positions, for the
  // in-place mode (chunked library items would artificially split segments).
  const fullTrails = useMemo(
    (): LibraryItem[] =>
      trailStates.map((state) => ({
        points: state.trail.points.map((p) => ({ x: p.x, y: p.y })),
        color: state.trail.color,
        id: state.trail.id,
      })),
    [trailStates],
  );

  const corridorMask = useMemo(() => {
    if (!imageStrokes || mode !== "inplace") return null;
    return dilateMask(
      imageStrokes.edgeMask,
      imageStrokes.width,
      imageStrokes.height,
      corridor,
    );
  }, [imageStrokes, mode, corridor]);

  const drawnTrails = useMemo(() => {
    if (!canvasStrokes || library.length === 0) return [];
    if (mode === "mosaic") {
      return mosaicTrails(canvasStrokes.strokes, library, allowRotation);
    }
    if (mode === "warp") {
      return warpTrails(canvasStrokes.strokes, library, warpStrength);
    }
    if (!corridorMask || !imageStrokes || !fit) return [];
    return inPlaceTrails(
      fullTrails,
      corridorMask,
      imageStrokes.width,
      imageStrokes.height,
      (p) => ({
        x: (p.x - fit.offsetX) / fit.scale,
        y: (p.y - fit.offsetY) / fit.scale,
      }),
      maxStrokes,
    );
  }, [
    canvasStrokes,
    library,
    mode,
    allowRotation,
    warpStrength,
    corridorMask,
    imageStrokes,
    fit,
    fullTrails,
    maxStrokes,
  ]);

  const sequence = useMemo(() => {
    const items = drawnTrails.map((trail) => ({
      trail,
      variedPoints: trail.points.map((p) => ({ x: p.x, y: p.y })),
      clicksWithProgress: [] as TrailState["clicksWithProgress"],
    }));
    return scheduleTrailSequence(items, {
      pxPerSecond,
      minDurationMs: 300,
      maxDurationMs: 4000,
      gapMs: 30,
      overlap,
      restMs: 4000,
    });
  }, [drawnTrails, pxPerSecond, overlap]);

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
      trailOpacity: 0.9,
      animationSpeed: 1,
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
    [strokeWidth],
  );

  const displayError = poolError ?? error;
  const statusText = loading
    ? "loading cursor events..."
    : displayError
      ? displayError
      : (!image
          ? `${library.length} gestures in the library`
          : `${drawnTrails.length} strokes from ${library.length} gestures`) +
        (deepening ? ` — deepening pool (${events.length} events)...` : "");

  return (
    <div style={styles.page}>
      <div style={styles.title}>cursor redraw</div>
      <div style={styles.status}>{statusText}</div>

      {!image && !loading && (
        <div style={styles.dropPrompt}>
          drop an image anywhere to draw it with cursor trails
        </div>
      )}

      {image && fit && showUnderlay && (
        <img
          src={image.objectUrl}
          alt=""
          style={{
            position: "fixed",
            left: fit.offsetX,
            top: fit.offsetY,
            width: fit.width,
            height: fit.height,
            opacity: 0.12,
            pointerEvents: "none",
          }}
        />
      )}

      {sequence.trailStates.length > 0 && (
        <AnimatedTrails
          key={`${mode}-${threshold}-${maxStrokes}-${allowRotation}-${warpStrength}-${corridor}-${image?.objectUrl}`}
          trailStates={sequence.trailStates}
          timeRange={timeRange}
          windowSize={sequence.trailStates.length}
          showClickRipples={false}
          settings={animationSettings}
        />
      )}

      <div style={styles.panel}>
        <div style={{ ...styles.row, gap: 6 }}>
          <button
            style={styles.modeButton(mode === "mosaic")}
            onClick={() => setMode("mosaic")}
          >
            mosaic
          </button>
          <button
            style={styles.modeButton(mode === "warp")}
            onClick={() => setMode("warp")}
          >
            warp
          </button>
          <button
            style={styles.modeButton(mode === "inplace")}
            onClick={() => setMode("inplace")}
          >
            in place
          </button>
        </div>
        <div style={styles.row}>
          <span>image</span>
          <input
            type="file"
            accept="image/*"
            style={{ width: 130, fontSize: 9 }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
        <div style={styles.row}>
          <span>edges: {threshold}</span>
          <input
            type="range"
            min={20}
            max={200}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>strokes: {maxStrokes}</span>
          <input
            type="range"
            min={20}
            max={400}
            step={10}
            value={maxStrokes}
            onChange={(e) => setMaxStrokes(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        {mode === "mosaic" && (
          <div style={styles.row}>
            <label>
              <input
                type="checkbox"
                checked={allowRotation}
                onChange={(e) => setAllowRotation(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              allow rotation
            </label>
          </div>
        )}
        {mode === "warp" && (
          <div style={styles.row}>
            <span>strength: {warpStrength.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={warpStrength}
              onChange={(e) => setWarpStrength(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
        )}
        {mode === "inplace" && (
          <div style={styles.row}>
            <span>corridor: {corridor}px</span>
            <input
              type="range"
              min={2}
              max={24}
              value={corridor}
              onChange={(e) => setCorridor(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
        )}
        <div style={styles.row}>
          <span>pace: {pxPerSecond}px/s</span>
          <input
            type="range"
            min={400}
            max={4000}
            step={100}
            value={pxPerSecond}
            onChange={(e) => setPxPerSecond(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>overlap: {overlap.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={0.98}
            step={0.02}
            value={overlap}
            onChange={(e) => setOverlap(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <span>stroke: {strokeWidth}</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            style={styles.slider}
          />
        </div>
        <div style={styles.row}>
          <label>
            <input
              type="checkbox"
              checked={showUnderlay}
              onChange={(e) => setShowUnderlay(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            show image underlay
          </label>
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<CursorRedraw />);
