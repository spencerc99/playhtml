# Cinematic Mode (cursor-follow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cursor-follow "cinematic" camera to the cursor-trail visualization so it reads as a moving-image installation — the camera rides one drawing cursor, then flies to a new one when it finishes.

**Architecture:** A pure `cinematicCamera.ts` module holds the camera state machine + viewBox math. `AnimatedTrails` owns one camera instance and, when cinematic mode is active, sets the SVG `viewBox` each frame from the live cursor positions it already computes in its rAF loop — no trail data changes. Cinematic config is parsed from URL params and toggled by keyboard, held as MovementCanvas-local state and passed down to AnimatedTrails. Both `live.tsx` and `archive.tsx` get the feature for free via MovementCanvas.

**Tech Stack:** React 18, TypeScript, SVG, Vite. Coordinate space: trail points are raw SVG user units (viewport pixels in default mode).

**Priority:** This is a PROTOTYPE. Prioritize a working, tunable visual feature and live footage over tests. Unit tests for `cinematicCamera.ts` are an OPTIONAL final task — skip unless asked. Verify each task in the browser preview instead.

## Global Constraints

- All new files MUST start with a 2-line `// ABOUTME:` comment.
- No emoji anywhere in the codebase. Use Unicode symbols or inline SVG if a glyph is needed.
- TypeScript strict mode; 2-space indent; named exports; match surrounding style.
- Camera viewBox MUST always keep the screen aspect ratio (`screenW/screenH`) because the SVG uses `preserveAspectRatio="none"` — otherwise trails stretch.
- This is website/experiment code under `extension/website/` — NO changeset needed, NO `apps/docs/` changes.
- Cinematic mode and `documentSpace` viewBox logic are mutually exclusive; cinematic wins when both could apply.

---

### Task 1: Pure camera module

Create the camera state machine and viewBox math as a standalone, side-effect-free module. This is the heart of the feature; everything else wires it in.

**Files:**
- Create: `extension/website/shared/utils/cinematicCamera.ts`

**Interfaces:**
- Produces:
  - `interface ViewBox { x: number; y: number; w: number; h: number }`
  - `interface CinematicConfig { mode: "follow"; zoom: number; transitionMs: number; centerLerp: number; velocityZoomOut: number }`
  - `interface CameraFrame { screenW: number; screenH: number; nowMs: number; activeTrails: Array<{ index: number; x: number; y: number; progress: number }> }`
  - `const DEFAULT_CINEMATIC_CONFIG: CinematicConfig` = `{ mode: "follow", zoom: 0.25, transitionMs: 3000, centerLerp: 0, velocityZoomOut: 0 }`
  - `class CinematicCamera { constructor(config: CinematicConfig); tick(frame: CameraFrame): ViewBox | null; reset(): void; setConfig(config: CinematicConfig): void }`
  - `tick` returns `null` only when it has never had a subject AND there are no active trails (caller then leaves the viewBox untouched / falls back to full-screen).

- [ ] **Step 1: Write the module**

```ts
// ABOUTME: Cursor-follow cinematic camera — pure state machine + viewBox math.
// ABOUTME: AnimatedTrails feeds it per-frame cursor positions; it returns the SVG viewBox to apply.

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CinematicConfig {
  /** Only "follow" is implemented today. */
  mode: "follow";
  /** Fraction of screen width visible while following (0.25 = tight zoom). */
  zoom: number;
  /** Fly-through duration between subjects, ms. */
  transitionMs: number;
  /** 0 = pure locked-center. >0 eases the camera center toward the cursor. */
  centerLerp: number;
  /** 0 = off. >0 zooms out proportional to cursor speed (px/frame). */
  velocityZoomOut: number;
}

export interface CameraFrame {
  screenW: number;
  screenH: number;
  nowMs: number;
  /** Trails currently drawing this frame: 0 < progress < 1. */
  activeTrails: Array<{ index: number; x: number; y: number; progress: number }>;
}

export const DEFAULT_CINEMATIC_CONFIG: CinematicConfig = {
  mode: "follow",
  zoom: 0.25,
  transitionMs: 3000,
  centerLerp: 0,
  velocityZoomOut: 0,
};

type Point = { x: number; y: number };

/** Build a viewBox centered on `center`, sized so `zoom` fraction of the
 * screen width is visible, with height corrected to the screen aspect ratio
 * so trails never stretch (SVG uses preserveAspectRatio="none"). */
function boxAround(center: Point, zoom: number, screenW: number, screenH: number): ViewBox {
  const w = Math.max(1, screenW * zoom);
  const aspect = screenH / Math.max(1, screenW);
  const h = w * aspect;
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpBox(a: ViewBox, b: ViewBox, t: number): ViewBox {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}

/** easeInOutCubic — smooth start and stop for the fly-through. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type State = "idle" | "following" | "flying";

export class CinematicCamera {
  private config: CinematicConfig;
  private state: State = "idle";
  private subjectIndex: number | null = null;
  private currentCenter: Point | null = null;
  private lastViewBox: ViewBox | null = null;
  // Fly-through tween bookkeeping.
  private flyFrom: ViewBox | null = null;
  private flyTo: ViewBox | null = null;
  private flyStartMs = 0;
  private flyTargetIndex: number | null = null;

  constructor(config: CinematicConfig) {
    this.config = config;
  }

  setConfig(config: CinematicConfig): void {
    this.config = config;
  }

  reset(): void {
    this.state = "idle";
    this.subjectIndex = null;
    this.currentCenter = null;
    this.lastViewBox = null;
    this.flyFrom = null;
    this.flyTo = null;
    this.flyTargetIndex = null;
  }

  /** Prefer a trail early in its draw so the camera rides most of it.
   * Deterministic: lowest progress wins (no RNG, keeps it predictable). */
  private selectNextSubject(
    activeTrails: CameraFrame["activeTrails"],
    exclude: number | null,
  ): number | null {
    let best: number | null = null;
    let bestProgress = Infinity;
    for (const t of activeTrails) {
      if (t.index === exclude) continue;
      if (t.progress < bestProgress) {
        bestProgress = t.progress;
        best = t.index;
      }
    }
    // If the only candidate is the excluded one, allow re-picking it rather
    // than stalling.
    if (best === null && activeTrails.length > 0) best = activeTrails[0].index;
    return best;
  }

  tick(frame: CameraFrame): ViewBox | null {
    const { activeTrails, screenW, screenH, nowMs } = frame;
    const byIndex = new Map(activeTrails.map((t) => [t.index, t]));

    // FLYING: tween regardless of subject availability; resolve on arrival.
    if (this.state === "flying" && this.flyFrom && this.flyTo) {
      const raw = (nowMs - this.flyStartMs) / this.config.transitionMs;
      const t = Math.min(1, Math.max(0, raw));
      const box = lerpBox(this.flyFrom, this.flyTo, ease(t));
      this.lastViewBox = box;
      if (t >= 1) {
        this.state = "following";
        this.subjectIndex = this.flyTargetIndex;
        this.flyFrom = null;
        this.flyTo = null;
        this.flyTargetIndex = null;
      }
      return box;
    }

    // IDLE: wait for a subject; leave viewBox untouched until one appears.
    if (this.state === "idle") {
      const next = this.selectNextSubject(activeTrails, null);
      if (next === null) return this.lastViewBox; // null on very first frames
      this.subjectIndex = next;
      this.state = "following";
      const s = byIndex.get(next)!;
      this.currentCenter = { x: s.x, y: s.y };
      const box = boxAround(this.currentCenter, this.config.zoom, screenW, screenH);
      this.lastViewBox = box;
      return box;
    }

    // FOLLOWING.
    const subject = this.subjectIndex !== null ? byIndex.get(this.subjectIndex) : undefined;
    const finishedOrGone =
      subject === undefined || subject.progress >= 1;

    if (finishedOrGone) {
      // Begin a fly-through to a fresh subject (or hold if none available).
      const next = this.selectNextSubject(activeTrails, this.subjectIndex);
      if (next === null) {
        // Nothing to fly to; hold the last frame.
        return this.lastViewBox;
      }
      const target = byIndex.get(next)!;
      const targetBox = boxAround(
        { x: target.x, y: target.y },
        this.config.zoom,
        screenW,
        screenH,
      );
      this.flyFrom = this.lastViewBox ?? targetBox;
      this.flyTo = targetBox;
      this.flyTargetIndex = next;
      this.flyStartMs = nowMs;
      this.state = "flying";
      return this.flyFrom;
    }

    // Continue following the live subject.
    let center: Point = { x: subject.x, y: subject.y };
    if (this.config.centerLerp > 0 && this.currentCenter) {
      center = {
        x: lerp(this.currentCenter.x, subject.x, this.config.centerLerp),
        y: lerp(this.currentCenter.y, subject.y, this.config.centerLerp),
      };
    }
    // velocityZoomOut: widen the box when the cursor is moving fast.
    let zoom = this.config.zoom;
    if (this.config.velocityZoomOut > 0 && this.currentCenter) {
      const speed = Math.hypot(subject.x - this.currentCenter.x, subject.y - this.currentCenter.y);
      zoom = this.config.zoom * (1 + this.config.velocityZoomOut * (speed / Math.max(1, screenW)));
    }
    this.currentCenter = center;
    const box = boxAround(center, zoom, screenW, screenH);
    this.lastViewBox = box;
    return box;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `bun run -C extension/website lint` (or `bunx tsc -p extension/website` if lint runs eslint too slowly)
Expected: no type errors from `cinematicCamera.ts`.

- [ ] **Step 3: Commit**

```bash
git add extension/website/shared/utils/cinematicCamera.ts
git commit -m "feat(website): cinematic camera state machine + viewBox math"
```

---

### Task 2: URL-param parsing for cinematic config

Add a parser that reads `?cinematic` / `?cinemaZoom` / `?cinemaTransition` (plus the off-by-default whip softeners) and returns a `CinematicConfig | null`.

**Files:**
- Modify: `extension/website/shared/config.ts` (add `parseCinematicFromUrl`)

**Interfaces:**
- Consumes: `CinematicConfig`, `DEFAULT_CINEMATIC_CONFIG` from Task 1.
- Produces: `export function parseCinematicFromUrl(): CinematicConfig | null` — returns `null` when `?cinematic` is absent or falsey, else a config with per-param overrides on top of defaults.

- [ ] **Step 1: Add the parser**

Add near the other `parse*FromUrl` helpers in `extension/website/shared/config.ts`:

```ts
import {
  DEFAULT_CINEMATIC_CONFIG,
  type CinematicConfig,
} from "./utils/cinematicCamera";

/** `?cinematic=1` or `?cinematic=follow` enables cursor-follow cinematic mode.
 * Optional tuning params layer on top of defaults:
 *   ?cinemaZoom=0.25        fraction of screen width visible while following
 *   ?cinemaTransition=3     fly-through seconds between subjects
 *   ?cinemaLerp=0           center smoothing (0 = pure locked-center)
 *   ?cinemaVelZoom=0        velocity-aware zoom-out (0 = off)
 * Returns null when cinematic mode is not requested. */
export function parseCinematicFromUrl(): CinematicConfig | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("cinematic");
  const on = raw !== null && raw !== "" && parseBool(raw) !== false;
  if (!on) return null;

  const zoom = parseNumber(params.get("cinemaZoom"));
  const transitionS = parseNumber(params.get("cinemaTransition"));
  const lerp = parseNumber(params.get("cinemaLerp"));
  const velZoom = parseNumber(params.get("cinemaVelZoom"));

  return {
    ...DEFAULT_CINEMATIC_CONFIG,
    mode: "follow",
    zoom: zoom !== undefined && zoom > 0 ? zoom : DEFAULT_CINEMATIC_CONFIG.zoom,
    transitionMs:
      transitionS !== undefined && transitionS > 0
        ? transitionS * 1000
        : DEFAULT_CINEMATIC_CONFIG.transitionMs,
    centerLerp: lerp !== undefined && lerp >= 0 ? lerp : DEFAULT_CINEMATIC_CONFIG.centerLerp,
    velocityZoomOut:
      velZoom !== undefined && velZoom >= 0 ? velZoom : DEFAULT_CINEMATIC_CONFIG.velocityZoomOut,
  };
}
```

Note: `?cinematic=follow` passes the `on` check because `parseBool("follow")` is `undefined` (not `false`), so it's treated as truthy-enable.

- [ ] **Step 2: Type-check**

Run: `bun run -C extension/website lint`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add extension/website/shared/config.ts
git commit -m "feat(website): parse cinematic URL params"
```

---

### Task 3: Wire the camera into AnimatedTrails

Add a `cinematic` prop to AnimatedTrails. When set, collect active-trail positions during the existing per-frame loop and set the SVG viewBox from `camera.tick(...)` instead of the document-space logic.

**Files:**
- Modify: `extension/website/shared/components/AnimatedTrails.tsx`

**Interfaces:**
- Consumes: `CinematicCamera`, `CinematicConfig`, `CameraFrame` from Task 1.
- Produces: new optional prop `cinematic?: CinematicConfig | null` on `AnimatedTrailsProps`.

- [ ] **Step 1: Import and add the prop**

At the top imports, add:

```ts
import { CinematicCamera, type CinematicConfig } from "../utils/cinematicCamera";
```

In `AnimatedTrailsProps` (after `documentSpace?: boolean;`), add:

```ts
  // When set, a cursor-follow camera drives the SVG viewBox each frame.
  // Mutually exclusive with documentSpace; cinematic wins.
  cinematic?: CinematicConfig | null;
```

Add `cinematic = null` to the destructured props in the component signature (alongside `documentSpace = false`).

- [ ] **Step 2: Create the camera instance + refs**

Near the other refs (after `const documentSpaceRef = useRef(documentSpace);`), add:

```ts
    const cinematicRef = useRef(cinematic);
    useEffect(() => {
      cinematicRef.current = cinematic;
    }, [cinematic]);

    const cameraRef = useRef<CinematicCamera | null>(null);
    if (cinematic && cameraRef.current === null) {
      cameraRef.current = new CinematicCamera(cinematic);
    }
    useEffect(() => {
      if (cinematic && cameraRef.current) cameraRef.current.setConfig(cinematic);
    }, [cinematic]);

    // Scratch array reused each frame to avoid per-frame allocation.
    const cameraActiveScratchRef = useRef<
      Array<{ index: number; x: number; y: number; progress: number }>
    >([]);
```

- [ ] **Step 3: Collect active-trail positions in the loop**

The loop already iterates `visibleIndices` and calls `handle.update(...)` producing `result.cursorPosition` and `result.trailProgress`. Inside that `for (const idx of visibleIndices)` block, where `result` is available and known truthy with `fade > 0`, append to the camera scratch when cinematic is on. Add this right after the `activePaintOrderIndices.push(idx);` area (anywhere `result` is in scope and valid):

```ts
          if (cinematicRef.current && result && fade > 0) {
            if (result.trailProgress > 0 && result.trailProgress < 1) {
              cameraActiveScratchRef.current.push({
                index: idx,
                x: result.cursorPosition.x,
                y: result.cursorPosition.y,
                progress: result.trailProgress,
              });
            }
          }
```

Before the `for (const idx of visibleIndices)` loop begins, clear the scratch:

```ts
        if (cinematicRef.current) {
          cameraActiveScratchRef.current.length = 0;
        }
```

- [ ] **Step 4: Apply the camera viewBox**

Replace the existing document-space viewBox block at the top of `animate` so cinematic takes precedence. Find:

```ts
        if (documentSpaceRef.current && svgRef.current) {
          const scrollX = window.scrollX;
          const scrollY = window.scrollY;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          svgRef.current.setAttribute(
            "viewBox",
            `${scrollX} ${scrollY} ${vw} ${vh}`,
          );
        }
```

Note this runs BEFORE the per-frame trail loop, but cinematic needs the positions computed DURING the loop. So: remove the cinematic concern from here, keep document-space as-is, and add the cinematic viewBox application AFTER the trail loop (after the sound-engine tick, before `scheduleNextFrame()`):

```ts
        if (cinematicRef.current && svgRef.current) {
          const camera = cameraRef.current;
          if (camera) {
            const vb = camera.tick({
              screenW: window.innerWidth,
              screenH: window.innerHeight,
              nowMs: timestamp,
              activeTrails: cameraActiveScratchRef.current,
            });
            if (vb) {
              svgRef.current.setAttribute(
                "viewBox",
                `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
              );
            }
          }
        }
```

And guard the document-space block so the two don't fight:

```ts
        if (!cinematicRef.current && documentSpaceRef.current && svgRef.current) {
```

- [ ] **Step 5: Reset camera on loop wrap and clear viewBox on disable**

In the loop-wrap detection block (where `resetPlaybackTrackers()` is called on `loopedElapsed < prevElapsedRef.current`), add:

```ts
          cameraRef.current?.reset();
```

Add an effect that clears the SVG viewBox when cinematic turns off, so the view returns to full-screen (`0 0 W H` default = no viewBox attribute):

```ts
    useEffect(() => {
      if (!cinematic && svgRef.current) {
        svgRef.current.removeAttribute("viewBox");
        cameraRef.current?.reset();
      }
    }, [cinematic]);
```

- [ ] **Step 6: Add `cinematic` to the memo comparator**

In the `memo` comparator at the bottom, add a line so prop changes re-render:

```ts
      prevProps.cinematic === nextProps.cinematic &&
```

(Place it next to the `documentSpace` comparison.)

- [ ] **Step 7: Type-check**

Run: `bun run -C extension/website lint`
Expected: no new type errors.

- [ ] **Step 8: Commit**

```bash
git add extension/website/shared/components/AnimatedTrails.tsx
git commit -m "feat(website): drive SVG viewBox from cinematic camera in AnimatedTrails"
```

---

### Task 4: MovementCanvas state, keyboard toggle, and prop pass-through

Hold cinematic config as MovementCanvas-local state (seeded from URL), toggle it with `Shift+C`, stub `1`/`2`/`3` mode keys, and pass config to both `AnimatedTrails` instances. live/archive need no changes.

**Files:**
- Modify: `extension/website/shared/components/MovementCanvas.tsx`

**Interfaces:**
- Consumes: `parseCinematicFromUrl` (Task 2), `DEFAULT_CINEMATIC_CONFIG`/`CinematicConfig` (Task 1), the `cinematic` prop on AnimatedTrails (Task 3).

- [ ] **Step 1: Imports + state**

Add imports:

```ts
import { parseCinematicFromUrl } from "../config";
import {
  DEFAULT_CINEMATIC_CONFIG,
  type CinematicConfig,
} from "../utils/cinematicCamera";
```

Add state near `const [controlsVisible, setControlsVisible] = useState(false);`:

```ts
  const [cinematic, setCinematic] = useState<CinematicConfig | null>(() =>
    parseCinematicFromUrl(),
  );
```

- [ ] **Step 2: Keyboard wiring**

In the `handleKeyPress` function (after the `Cmd/Ctrl+Shift+S` block, before the `const now = Date.now();` double-tap family), add:

```ts
      // Shift+C → toggle cinematic (cursor-follow) mode.
      if (e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        setCinematic((prev) =>
          prev ? null : parseCinematicFromUrl() ?? DEFAULT_CINEMATIC_CONFIG,
        );
        return;
      }

      // Mode switches (stubs for hand-choreographing later).
      // 3 = cursor-follow (only one implemented). 1 = wide, 2 = activity.
      if (e.key === "1" || e.key === "2") {
        console.info(`[cinematic] mode ${e.key} not yet implemented`);
        return;
      }
      if (e.key === "3") {
        setCinematic((prev) => prev ?? parseCinematicFromUrl() ?? DEFAULT_CINEMATIC_CONFIG);
        return;
      }
```

Note: the keydown effect's dependency array is `[fetchEvents, handleCapture]` — `setCinematic`/`parseCinematicFromUrl` are stable, so no dependency change needed.

- [ ] **Step 3: Pass to both AnimatedTrails**

On BOTH `<AnimatedTrails .../>` usages (the main one near line 1406 and any second instance), add the prop:

```tsx
              cinematic={cinematic}
```

(Verify there's only the one instance via `grep -n "<AnimatedTrails" extension/website/shared/components/MovementCanvas.tsx` — add the prop to each.)

- [ ] **Step 4: Type-check**

Run: `bun run -C extension/website lint`
Expected: no new type errors.

- [ ] **Step 5: Commit**

```bash
git add extension/website/shared/components/MovementCanvas.tsx
git commit -m "feat(website): cinematic mode state + keyboard toggle, pass to AnimatedTrails"
```

---

### Task 5: Verify live in browser and capture footage

Run the dev server and confirm the camera follows cursors and flies between them. Capture video. This is the real acceptance gate for this prototype.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Use the preview tooling (preview_start) on the website dev server, or `bun run -C extension/website dev`. Load the live portrait page with `?cinematic=1`.

- [ ] **Step 2: Verify behavior**

- Camera zooms in and locks onto a drawing cursor (subject centered).
- When that cursor's trail finishes, camera flies (~3s) to a new subject.
- No stretching/squashing of trails (aspect ratio correct).
- `Shift+C` toggles cinematic off → returns to full-screen wide view; on → re-enters follow.
- Check console for errors (preview_console_logs).

- [ ] **Step 3: If live is too sparse, use a busy archive day**

Load the archive page (`/archive/`) on a dense historical day (pick a day with high counts from the calendar) with `?cinematic=1` so the camera has many subjects to ride and fly between.

- [ ] **Step 4: Record video**

Screen-record (preview_screenshot is a still; for video use the browser/screen recording flow) a ~30–60s clip of the camera riding cursors and flying between them. Try a few tunings via URL params:
- `?cinematic=1&cinemaZoom=0.2&cinemaTransition=3` (tight)
- `?cinematic=1&cinemaZoom=0.35&cinemaTransition=4` (looser, slower flights)
- Optional whip-softening: `&cinemaLerp=0.15` or `&cinemaVelZoom=0.5`

Share the video file(s) with Spencer via SendUserFile for review and tuning.

- [ ] **Step 5: Commit any tuning-default changes (if made)**

If the default zoom/transition feel wrong and you change `DEFAULT_CINEMATIC_CONFIG`, commit it:

```bash
git add extension/website/shared/utils/cinematicCamera.ts
git commit -m "tune(website): adjust cinematic default zoom/transition"
```

---

### Task 6 (OPTIONAL — skip during prototyping): Unit tests for the camera

Only do this once the interaction feels right or Spencer asks. Tests against an unsettled design get thrown away.

**Files:**
- Create: `extension/website/shared/utils/__tests__/cinematicCamera.test.ts`

Cover: aspect-ratio correction (`w/h === screenW/screenH` for any zoom); pure locked-center maps subject to box center when `centerLerp=0`; fly-through starts at previous box, ends at target box, lasts `transitionMs`, eases; `selectNextSubject` prefers lowest progress; `reset()` clears state. Run with `bun run -C extension/website test` (confirm the test runner config covers `shared/`).

---

## Self-Review

- **Spec coverage:** cursor-follow camera (Task 1, 3), fly-through transitions (Task 1), follow-to-finish selection (Task 1 `selectNextSubject`), URL activation (Task 2), keyboard toggle + mode stubs (Task 4), both pages via MovementCanvas (Task 4), aspect-ratio constraint (Task 1 `boxAround`), cinematic-vs-document-space precedence (Task 3 guard), live+archive footage (Task 5), tests deferred/optional (Task 6). All spec sections mapped.
- **Placeholder scan:** all code steps contain full code; no TBD/TODO.
- **Type consistency:** `CinematicConfig`, `CameraFrame`, `ViewBox`, `CinematicCamera`, `DEFAULT_CINEMATIC_CONFIG`, `parseCinematicFromUrl` names match across tasks.
- **Prototype priority honored:** tests are the last, optional task; verification is browser-based each task.
