// ABOUTME: Drawing canvas for creating hand-drawn cursors using perfect-freehand.
// ABOUTME: Provides pen tool, color palette, undo, and clear controls.
import React, { useRef, useState, useCallback } from "react";
import { getStroke } from "perfect-freehand";
import type { Stroke } from "./svg-utils";

const COLORS = [
  "#000000", // black
  "#e74c3c", // red
  "#f39c12", // orange
  "#2ecc71", // green
  "#3498db", // blue
  "#9b59b6", // purple
  "#e84393", // pink
  "#1abc9c", // teal
];

const CANVAS_SIZE = 128;
const DISPLAY_SIZE = 300;

const STROKE_OPTIONS = {
  size: 6,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
};

function average(a: number, b: number): number {
  return (a + b) / 2;
}

function getSvgPathFromStroke(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  result += "Z";
  return result;
}

interface DrawingCanvasProps {
  onComplete: (strokes: Stroke[]) => void;
  initialStrokes?: Stroke[];
}

export function DrawingCanvas({
  onComplete,
  initialStrokes,
}: DrawingCanvasProps) {
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes ?? []);
  const [currentPoints, setCurrentPoints] = useState<number[][]>([]);
  const [currentColor, setCurrentColor] = useState(COLORS[0]);
  const [isDrawing, setIsDrawing] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const getPointerPosition = useCallback(
    (e: React.PointerEvent): [number, number, number] => {
      const svg = svgRef.current;
      if (!svg) return [0, 0, 0.5];
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE;
      const y = ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE;
      return [x, y, e.pressure || 0.5];
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      setIsDrawing(true);
      setCurrentPoints([getPointerPosition(e)]);
    },
    [getPointerPosition]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      setCurrentPoints((prev) => [...prev, getPointerPosition(e)]);
    },
    [isDrawing, getPointerPosition]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      setIsDrawing(false);

      if (currentPoints.length < 2) {
        setCurrentPoints([]);
        return;
      }

      const outlinePoints = getStroke(currentPoints, STROKE_OPTIONS);
      const svgPath = getSvgPathFromStroke(outlinePoints);

      if (svgPath) {
        setStrokes((prev) => [...prev, { color: currentColor, svgPath }]);
      }
      setCurrentPoints([]);
    },
    [isDrawing, currentPoints, currentColor]
  );

  const handleUndo = () => setStrokes((prev) => prev.slice(0, -1));
  const handleClear = () => setStrokes([]);
  const hasStrokes = strokes.length > 0;

  // Live preview of current stroke
  const currentStrokeOutline =
    currentPoints.length >= 2 ? getStroke(currentPoints, STROKE_OPTIONS) : null;
  const currentStrokePath = currentStrokeOutline
    ? getSvgPathFromStroke(currentStrokeOutline)
    : "";

  return (
    <div className="drawing-canvas">
      <h2>draw your cursor</h2>
      <div className="canvas-container">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
          width={DISPLAY_SIZE}
          height={DISPLAY_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ touchAction: "none" }}
        >
          {/* Completed strokes */}
          {strokes.map((stroke, i) => (
            <path key={i} d={stroke.svgPath} fill={stroke.color} />
          ))}
          {/* Current stroke being drawn */}
          {currentStrokePath && (
            <path d={currentStrokePath} fill={currentColor} />
          )}
        </svg>
      </div>

      <div className="color-palette">
        {COLORS.map((color) => (
          <button
            key={color}
            className={`color-swatch ${color === currentColor ? "active" : ""}`}
            style={{ backgroundColor: color }}
            onClick={() => setCurrentColor(color)}
          />
        ))}
      </div>

      <div className="canvas-actions">
        <button onClick={handleUndo} disabled={!hasStrokes}>
          undo
        </button>
        <button onClick={handleClear} disabled={!hasStrokes}>
          clear
        </button>
        <button
          className="done-button"
          onClick={() => onComplete(strokes)}
          disabled={!hasStrokes}
        >
          done
        </button>
      </div>
    </div>
  );
}
