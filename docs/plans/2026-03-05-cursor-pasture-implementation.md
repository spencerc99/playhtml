# Cursor Pasture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a playhtml experiment where visitors hand-draw cursors and enter a serene pasture scene with creature-like cursor animations.

**Architecture:** React app using `withSharedState` for persistent cursor drawings, playhtml's native cursor system for live presence via `onCustomCursorRender`, and `perfect-freehand` for hand-drawn stroke rendering. SVG paths stored in shared state, composed into data URLs for CSS cursors and rendered elements.

**Tech Stack:** React, TypeScript, perfect-freehand, @playhtml/react, SCSS

**Design doc:** `docs/plans/2026-03-05-cursor-pasture-design.md`

---

### Task 1: Project Scaffolding & Dependencies

**Files:**
- Create: `website/experiments/cursor-pasture/index.html`
- Create: `website/experiments/cursor-pasture/cursor-pasture.tsx`
- Create: `website/experiments/cursor-pasture/cursor-pasture.scss`
- Modify: `package.json` (add perfect-freehand dependency)

**Step 1: Install perfect-freehand**

Run: `bun add perfect-freehand`
Expected: package added to package.json

**Step 2: Create the HTML shell**

Create `website/experiments/cursor-pasture/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/icon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="draw your cursor and watch it graze in the cursor pasture"
    />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Play:wght@400;700&display=swap"
      rel="stylesheet"
    />
    <title>cursor pasture — playhtml experiment</title>
  </head>
  <body>
    <div id="reactContent"></div>
    <script type="module" src="./cursor-pasture.tsx"></script>
  </body>
</html>
```

**Step 3: Create minimal entrypoint and styles**

Create `website/experiments/cursor-pasture/cursor-pasture.tsx`:

```tsx
// ABOUTME: Entrypoint for the cursor pasture experiment.
// ABOUTME: Renders the PlayProvider and main CursorPasture component.
import "./cursor-pasture.scss";
import React from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider } from "@playhtml/react";

function CursorPasture() {
  return <div id="pasture">cursor pasture — coming soon</div>;
}

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider
    initOptions={{
      cursors: {
        enabled: true,
      },
    }}
  >
    <CursorPasture />
  </PlayProvider>
);
```

Create `website/experiments/cursor-pasture/cursor-pasture.scss`:

```scss
@import "../../base.scss";

html, body {
  overflow: hidden;
}

#pasture {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Step 4: Verify it loads**

Run: `bun dev`
Navigate to the cursor-pasture experiment page in the browser. Confirm "cursor pasture — coming soon" renders.

**Step 5: Commit**

```bash
git add website/experiments/cursor-pasture/ package.json bun.lock
git commit -m "scaffold cursor pasture experiment"
```

---

### Task 2: SVG Composition Utilities

**Files:**
- Create: `website/experiments/cursor-pasture/svg-utils.ts`

**Step 1: Create svg-utils.ts**

This file provides two functions: one to compose a `CursorDrawing` into an SVG string, and one to convert it to a CSS cursor data URL.

```typescript
// ABOUTME: Utilities for composing cursor stroke data into SVG strings.
// ABOUTME: Used for CSS cursors, live cursor rendering, and pasture scene display.

export interface Stroke {
  color: string;
  svgPath: string;
}

export interface CursorDrawing {
  creatorId: string;
  strokes: Stroke[];
  createdAt: number;
}

export function composeSvg(strokes: Stroke[], size: number = 32): string {
  const paths = strokes
    .map((s) => `<path d="${s.svgPath}" fill="${s.color}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">${paths}</svg>`;
}

export function composeSvgDataUrl(strokes: Stroke[], size: number = 32): string {
  const svg = composeSvg(strokes, size);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function cssCursorFromStrokes(strokes: Stroke[]): string {
  if (strokes.length === 0) return "auto";
  return `url("${composeSvgDataUrl(strokes)}"), auto`;
}
```

**Step 2: Commit**

```bash
git add website/experiments/cursor-pasture/svg-utils.ts
git commit -m "add SVG composition utilities for cursor strokes"
```

---

### Task 3: Drawing Canvas Component

**Files:**
- Create: `website/experiments/cursor-pasture/drawing-canvas.tsx`

This is the core drawing component using perfect-freehand. It manages stroke state internally and calls `onComplete` with the final strokes array.

**Step 1: Create the drawing canvas component**

```tsx
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
const SCALE = DISPLAY_SIZE / CANVAS_SIZE;

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

export function DrawingCanvas({ onComplete, initialStrokes }: DrawingCanvasProps) {
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
```

**Step 2: Commit**

```bash
git add website/experiments/cursor-pasture/drawing-canvas.tsx
git commit -m "add drawing canvas component with perfect-freehand"
```

---

### Task 4: Main Component with Drawing Flow & Shared State

**Files:**
- Modify: `website/experiments/cursor-pasture/cursor-pasture.tsx`

Wire up `withSharedState` for the cursor collection, the drawing overlay, and the cursor-setting logic. Uses `cursorPresences` from `usePlayContext()` to determine online users, and `configureCursors` to set up `onCustomCursorRender`.

**Step 1: Rewrite the entrypoint with full component logic**

Replace `website/experiments/cursor-pasture/cursor-pasture.tsx` with:

```tsx
// ABOUTME: Entrypoint for the cursor pasture experiment.
// ABOUTME: Manages drawing flow, shared cursor state, and live cursor rendering.
import "./cursor-pasture.scss";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";
import { DrawingCanvas } from "./drawing-canvas";
import { PastureScene } from "./pasture-scene";
import {
  composeSvg,
  composeSvgDataUrl,
  cssCursorFromStrokes,
  type CursorDrawing,
  type Stroke,
} from "./svg-utils";

const CursorPasture = withSharedState(
  {
    defaultData: {
      cursors: [] as CursorDrawing[],
    },
  },
  ({ data, setData }) => {
    const { configureCursors, cursorPresences, getMyPlayerIdentity } =
      usePlayContext();
    const [showDrawing, setShowDrawing] = useState(false);
    const [hasCheckedIdentity, setHasCheckedIdentity] = useState(false);

    const myIdentity = getMyPlayerIdentity();
    const myPublicKey = myIdentity?.publicKey;

    const myCursor = useMemo(
      () => data.cursors.find((c) => c.creatorId === myPublicKey),
      [data.cursors, myPublicKey]
    );

    // Determine which creators are currently online
    const onlineCreatorIds = useMemo(() => {
      const ids = new Set<string>();
      cursorPresences.forEach((presence) => {
        const pk = presence.playerIdentity?.publicKey;
        if (pk) ids.add(pk);
      });
      return ids;
    }, [cursorPresences]);

    // On first load, check if user needs to draw
    useEffect(() => {
      if (!myPublicKey || hasCheckedIdentity) return;
      setHasCheckedIdentity(true);
      if (!myCursor) {
        setShowDrawing(true);
      }
    }, [myPublicKey, myCursor, hasCheckedIdentity]);

    // Set own CSS cursor when we have a drawing
    useEffect(() => {
      if (myCursor && myCursor.strokes.length > 0) {
        document.body.style.cursor = cssCursorFromStrokes(myCursor.strokes);
      }
      return () => {
        document.body.style.cursor = "";
      };
    }, [myCursor]);

    // Configure custom cursor rendering for other users' live cursors
    useEffect(() => {
      const cursorsMap = new Map(
        data.cursors.map((c) => [c.creatorId, c])
      );

      configureCursors({
        onCustomCursorRender: (connectionId, element) => {
          // Find the publicKey for this connectionId from cursorPresences
          let drawingForConnection: CursorDrawing | undefined;
          cursorPresences.forEach((presence) => {
            const pk = presence.playerIdentity?.publicKey;
            if (pk) {
              const drawing = cursorsMap.get(pk);
              if (drawing) {
                // Match by checking if this presence's data corresponds to the connectionId
                // The connectionId IS the stable key in cursorPresences map
                drawingForConnection = drawing;
              }
            }
          });

          // Try direct lookup: cursorPresences is keyed by stableId (publicKey)
          // but connectionId might be a clientId. Check both.
          if (!drawingForConnection) {
            const presence = cursorPresences.get(connectionId);
            if (presence?.playerIdentity?.publicKey) {
              drawingForConnection = cursorsMap.get(
                presence.playerIdentity.publicKey
              );
            }
          }

          if (
            drawingForConnection &&
            drawingForConnection.strokes.length > 0
          ) {
            const svg = composeSvg(drawingForConnection.strokes, 40);
            element.innerHTML = svg;
            element.style.pointerEvents = "none";
            return element;
          }
          return null;
        },
      });
    }, [data.cursors, cursorPresences, configureCursors]);

    const handleDrawingComplete = useCallback(
      (strokes: Stroke[]) => {
        if (!myPublicKey || strokes.length === 0) return;

        setData((draft) => {
          const existingIdx = draft.cursors.findIndex(
            (c) => c.creatorId === myPublicKey
          );
          const newDrawing: CursorDrawing = {
            creatorId: myPublicKey,
            strokes,
            createdAt: Date.now(),
          };
          if (existingIdx >= 0) {
            draft.cursors[existingIdx] = newDrawing;
          } else {
            draft.cursors.push(newDrawing);
          }
        });

        setShowDrawing(false);
      },
      [myPublicKey, setData]
    );

    return (
      <div id="pasture">
        <PastureScene
          cursors={data.cursors}
          onlineCreatorIds={onlineCreatorIds}
          myCreatorId={myPublicKey}
        />

        <div className="pasture-ui">
          <div className="online-count">
            {cursorPresences.size} cursor{cursorPresences.size !== 1 ? "s" : ""}{" "}
            roaming
          </div>
          <button
            className="redraw-button"
            onClick={() => setShowDrawing(true)}
          >
            re-draw
          </button>
        </div>

        {showDrawing && (
          <div className="drawing-overlay">
            <div className="drawing-modal">
              <DrawingCanvas
                onComplete={handleDrawingComplete}
                initialStrokes={myCursor?.strokes}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider
    initOptions={{
      cursors: {
        enabled: true,
      },
    }}
  >
    <CursorPasture />
  </PlayProvider>
);
```

**Step 2: Commit**

```bash
git add website/experiments/cursor-pasture/cursor-pasture.tsx
git commit -m "wire up main component with drawing flow and shared state"
```

---

### Task 5: Pasture Scene Component

**Files:**
- Create: `website/experiments/cursor-pasture/pasture-scene.tsx`

Renders the background, horizon line, and perched cursors with idle animations and occasional flights.

**Step 1: Create the pasture scene**

```tsx
// ABOUTME: Renders the pasture background and perched/ghost cursors along the horizon.
// ABOUTME: Handles idle twitching animations and occasional flight arcs.
import React, { useEffect, useRef, useMemo, useCallback } from "react";
import { composeSvgDataUrl, type CursorDrawing } from "./svg-utils";

interface PastureSceneProps {
  cursors: CursorDrawing[];
  onlineCreatorIds: Set<string>;
  myCreatorId?: string;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export function PastureScene({
  cursors,
  onlineCreatorIds,
  myCreatorId,
}: PastureSceneProps) {
  const flightTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Position each cursor along the horizon with deterministic randomness
  const positioned = useMemo(() => {
    return cursors.map((cursor, i) => {
      const rand = seededRandom(cursor.createdAt);
      const xPercent = 5 + rand() * 90; // 5% to 95% of viewport width
      const yOffset = (rand() - 0.5) * 20; // ±10px from horizon
      const animDelay = rand() * 8; // 0-8s animation delay
      const twitchDuration = 3 + rand() * 4; // 3-7s twitch cycle
      return { cursor, xPercent, yOffset, animDelay, twitchDuration };
    });
  }, [cursors]);

  // Trigger random flights
  useEffect(() => {
    const perchedElements = () =>
      document.querySelectorAll<HTMLElement>(".perched-cursor:not(.ghost):not(.flying)");

    flightTimerRef.current = setInterval(() => {
      const perched = perchedElements();
      if (perched.length === 0) return;
      const target = perched[Math.floor(Math.random() * perched.length)];
      target.classList.add("flying");
      setTimeout(() => target.classList.remove("flying"), 3000);
    }, 15000 + Math.random() * 15000);

    return () => clearInterval(flightTimerRef.current);
  }, []);

  return (
    <div className="pasture-scene">
      <div className="pasture-bg" />
      <div className="horizon">
        {positioned.map(
          ({ cursor, xPercent, yOffset, animDelay, twitchDuration }) => {
            const isOnline = onlineCreatorIds.has(cursor.creatorId);
            const isMine = cursor.creatorId === myCreatorId;
            const isGhost = isOnline || isMine;
            const svgUrl = composeSvgDataUrl(cursor.strokes, 28);

            return (
              <div
                key={cursor.creatorId}
                className={`perched-cursor ${isGhost ? "ghost" : ""}`}
                style={{
                  left: `${xPercent}%`,
                  bottom: `${33 + yOffset / window.innerHeight * 100}%`,
                  animationDelay: `${animDelay}s`,
                  animationDuration: `${twitchDuration}s`,
                }}
              >
                <img src={svgUrl} alt="cursor" draggable={false} />
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add website/experiments/cursor-pasture/pasture-scene.tsx
git commit -m "add pasture scene with perched cursors and flight animations"
```

---

### Task 6: Styles — Pasture Scene, Drawing Overlay, Animations

**Files:**
- Modify: `website/experiments/cursor-pasture/cursor-pasture.scss`

**Step 1: Write full styles**

Replace `website/experiments/cursor-pasture/cursor-pasture.scss` with the complete stylesheet. This includes:

- Pasture background with grain texture
- Horizon line positioning
- Perched cursor idle twitch animation
- Flight arc keyframes
- Ghost cursor (opacity + blur)
- Drawing overlay (dimmed backdrop, centered modal)
- Drawing canvas styles (checkerboard, color palette, buttons)
- UI elements (online count, re-draw button)

```scss
@import "../../base.scss";

// --- Layout ---

html, body {
  overflow: hidden;
  font-family: "Play", sans-serif;
}

#pasture {
  width: 100vw;
  height: 100vh;
  position: relative;
}

// --- Pasture Background ---

.pasture-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.pasture-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    hsl(30, 10%, 92%) 0%,
    hsl(30, 8%, 88%) 50%,
    hsl(30, 12%, 84%) 67%,
    hsl(30, 10%, 80%) 100%
  );

  // Grain texture overlay
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    opacity: 0.08;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 200px;
    pointer-events: none;
  }
}

// --- Horizon & Perched Cursors ---

.horizon {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50%;
}

.perched-cursor {
  position: absolute;
  width: 28px;
  height: 28px;
  animation: twitch ease-in-out infinite;
  transition: opacity 0.5s, filter 0.5s;

  img {
    width: 100%;
    height: 100%;
  }

  &.ghost {
    opacity: 0.25;
    filter: blur(0.5px);
  }

  &.flying {
    animation: flight 3s ease-in-out forwards;
  }
}

@keyframes twitch {
  0%, 100% {
    transform: translate(0, 0) rotate(0deg);
  }
  25% {
    transform: translate(0.5px, -1px) rotate(0.5deg);
  }
  50% {
    transform: translate(-0.5px, 0) rotate(-0.5deg);
  }
  75% {
    transform: translate(0.5px, -0.5px) rotate(0.3deg);
  }
}

@keyframes flight {
  0% {
    transform: translate(0, 0) rotate(0deg);
  }
  20% {
    transform: translate(20px, -80px) rotate(-10deg);
  }
  50% {
    transform: translate(60px, -120px) rotate(5deg);
  }
  80% {
    transform: translate(30px, -40px) rotate(-5deg);
  }
  100% {
    transform: translate(0, 0) rotate(0deg);
  }
}

// --- UI Elements ---

.pasture-ui {
  position: fixed;
  bottom: 24px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  pointer-events: none;
  z-index: 10;

  > * {
    pointer-events: auto;
  }
}

.online-count {
  font-size: 0.85rem;
  color: hsl(30, 10%, 50%);
  user-select: none;
}

.redraw-button {
  font-size: 0.8rem;
  padding: 6px 14px;
  border: 1px solid hsl(30, 10%, 70%);
  border-radius: 6px;
  background: hsla(30, 10%, 95%, 0.8);
  color: hsl(30, 10%, 40%);
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.2s, border-color 0.2s;

  &:hover {
    background: hsla(30, 10%, 90%, 0.9);
    border-color: hsl(30, 10%, 55%);
  }
}

// --- Drawing Overlay ---

.drawing-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsla(30, 10%, 20%, 0.5);
  backdrop-filter: blur(4px);
}

.drawing-modal {
  background: hsl(30, 10%, 96%);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 8px 40px hsla(0, 0%, 0%, 0.15);
}

// --- Drawing Canvas ---

.drawing-canvas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  h2 {
    font-size: 1.2rem;
    font-weight: 400;
    color: hsl(30, 10%, 35%);
  }
}

.canvas-container {
  position: relative;
  border-radius: 8px;
  overflow: hidden;

  // Checkerboard transparency pattern
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(45deg, hsl(30, 5%, 90%) 25%, transparent 25%),
      linear-gradient(-45deg, hsl(30, 5%, 90%) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, hsl(30, 5%, 90%) 75%),
      linear-gradient(-45deg, transparent 75%, hsl(30, 5%, 90%) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
    pointer-events: none;
    z-index: -1;
  }

  svg {
    display: block;
    cursor: crosshair;
  }
}

.color-palette {
  display: flex;
  gap: 8px;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
  padding: 0;

  &.active {
    border-color: hsl(30, 10%, 35%);
    transform: scale(1.15);
  }

  &:hover:not(.active) {
    transform: scale(1.08);
  }
}

.canvas-actions {
  display: flex;
  gap: 10px;

  button {
    padding: 8px 18px;
    border: 1px solid hsl(30, 10%, 75%);
    border-radius: 6px;
    background: hsl(30, 10%, 98%);
    color: hsl(30, 10%, 35%);
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s, opacity 0.2s;

    &:hover:not(:disabled) {
      background: hsl(30, 10%, 92%);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &.done-button {
      background: hsl(30, 10%, 30%);
      color: hsl(30, 10%, 96%);
      border-color: hsl(30, 10%, 30%);

      &:hover:not(:disabled) {
        background: hsl(30, 10%, 22%);
      }
    }
  }
}

// --- Hide system cursor when drawing is active ---
.drawing-overlay svg {
  cursor: crosshair;
}
```

**Step 2: Commit**

```bash
git add website/experiments/cursor-pasture/cursor-pasture.scss
git commit -m "add full styles for pasture scene, drawing overlay, and animations"
```

---

### Task 7: Integration Testing & Polish

**Files:**
- Possibly modify any of the above files based on testing

**Step 1: Start dev server and test the full flow**

Run: `bun dev`

Test the following in browser:

1. Navigate to cursor-pasture experiment page
2. Drawing overlay appears (first visit — no cursor in shared state for your publicKey)
3. Draw some strokes on the canvas — pen should render with perfect-freehand smoothing
4. Test color switching, undo, clear
5. Click "done" — overlay closes, your cursor changes to the hand-drawn SVG
6. Refresh page — should skip drawing overlay and load your cursor immediately
7. Open a second browser/incognito window — should see each other's live cursors rendered as hand-drawn SVGs
8. Check the pasture scene shows perched cursors for any that exist

**Step 2: Fix any issues discovered during testing**

Address bugs, adjust sizing, tweak animations as needed.

**Step 3: Test the onCustomCursorRender integration**

The `onCustomCursorRender` callback maps connectionId → publicKey → CursorDrawing. This is the trickiest integration point. Verify:
- Other users' cursors show as hand-drawn SVGs, not default arrow cursors
- If the lookup fails gracefully (returns null → default cursor renders)

**Step 4: Commit final state**

```bash
git add -A  # after reviewing git status
git commit -m "cursor pasture experiment: integration testing and polish"
```

---

### Task 8: Final Review

**Step 1: Review all files for ABOUTME comments**

Every `.ts` and `.tsx` file must start with two lines of `// ABOUTME:` comments.

**Step 2: Review for code quality**

- No unused imports
- No `console.log` left in
- Consistent naming
- Types properly defined

**Step 3: Final commit if needed**

```bash
git add website/experiments/cursor-pasture/
git commit -m "cursor pasture: final cleanup"
```
