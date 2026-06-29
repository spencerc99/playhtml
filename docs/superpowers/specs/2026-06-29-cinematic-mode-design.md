# Cinematic Mode for AnimatedTrails — Design

Date: 2026-06-29
Status: Approved (design); pending spec review → implementation plan

## Goal

Add a "cinematic mode" to the cursor-trail visualization so it works as a moving-image installation piece — a camera that follows the work and the people at different scales. The view becomes more dynamic by moving the camera through the scene rather than always showing a static wide shot.

This first deliverable is a **single-screen choreographer** focused entirely on **cursor-follow**: the camera rides one actively-drawing cursor like a third-person video-game chase cam, then flies to a new subject when that cursor finishes its trail. It runs on both the live portrait page and the archive page, and is recordable for video review.

Multi-channel installation rigs, activity-zoom (mid-level "lots of activity" view), wide establishing shots, and auto-cycle choreography are explicitly **deferred** — but the design leaves clean extension points for them.

## Scope

In scope (build now):
- Cursor-follow camera with locked-center framing
- Fly-through transitions between subjects (tunable duration, default 3s)
- `follow-to-finish` subject-selection strategy
- URL-param + keyboard activation
- A pure, unit-tested camera module
- Live-data screen-recorded demo videos (archive fallback if live is sparse)

Out of scope (deferred, but stubbed for easy extension):
- Activity-zoom mode and wide establishing shots
- Auto-cycle choreography timeline
- Intersection-handoff and timed-hop subject strategies
- Multi-channel / multi-window coordination

## Scope correction (discovered during implementation, 2026-06-29)

The live page renders a SEPARATE component, `LiveTrails`, not `AnimatedTrails`
(`MovementCanvas.tsx`: `live ? <LiveTrails/> : <AnimatedTrails/>`). The archive
page uses `AnimatedTrails`. Both share the same SVG structure and both compute
per-trail `cursorPosition` each frame, so the same camera approach works in
both — but they are two implementations.

Decision: ship cinematic on the ARCHIVE page only for this first pass (denser
cursors on a busy historical day make better footage anyway). Wiring the same
camera into `LiveTrails` is a deferred follow-up once the feel is tuned.

## Background: how the rendering pipeline works (verified)

- `live.tsx` and `archive.tsx` both render through `MovementCanvas`. The archive
  path renders `AnimatedTrails` (wired for cinematic); the live path renders
  `LiveTrails` (cinematic deferred — see scope correction above).
- Trail points are stored as **pixel coordinates** and rendered **directly as SVG user units** — no transformation between data and screen. (`useCursorTrails.ts:222–239`, `trailPrimitives.tsx`.)
  - Viewport mode (default for live/archive): x/y are viewport pixels in `[0, viewportSize.width/height]`.
  - Document-space mode: x/y are absolute document pixels.
- The SVG is `width/height=100%`, `preserveAspectRatio="none"`, `position:absolute`. (`AnimatedTrails.tsx:595–606`.)
- The animation rAF loop in `AnimatedTrails` already:
  - Computes every visible cursor's live position each frame via `handle.update(...)` → `result.cursorPosition`. (`AnimatedTrails.tsx:420–448`.)
  - Knows each trail's progress (`result.trailProgress`, `0..1`).
  - Already sets the SVG `viewBox` each frame in document-space mode. (`AnimatedTrails.tsx:304–312`.)

**Conclusion (the crux):** the camera can be implemented purely by setting the SVG `viewBox` each frame — no trail data changes. The cursor positions cinematic-follow needs are already being computed in the loop.

### The aspect-ratio constraint (important)

Because the SVG uses `preserveAspectRatio="none"`:
- In **viewport mode** there is currently **no explicit viewBox** (it defaults to `0 0 W H`). Cinematic mode must set an explicit viewBox in this mode.
- Any camera viewBox MUST keep the **same aspect ratio as the on-screen SVG** (`viewportSize.width / viewportSize.height`), or trails stretch/squash. The camera computes a box from a center point + zoom, then corrects width/height to the screen aspect ratio.

## Architecture

Data flow:

```
live.tsx / archive.tsx
  → parse ?cinematic / ?cinemaZoom / ?cinemaTransition from URL
  → pass `cinematic` config to MovementCanvas
MovementCanvas
  → pass `cinematic` config + viewportSize down to AnimatedTrails
AnimatedTrails (owns the rAF loop)
  → owns one CinematicCamera instance
  → each frame: feed camera the active-trail info + per-cursor live positions
  → apply camera.viewBox to svgRef
```

### New module: `shared/utils/cinematicCamera.ts` (pure, tested)

Holds the camera state machine and per-frame viewBox math. Keeping it out of the ~750-line rAF loop keeps it reviewable and reusable for the deferred multi-channel work.

Responsibilities:
- Maintain camera state: `IDLE | FOLLOWING | FLYING`, current subject trail index, current/target viewBox, fly-through start time + progress.
- `tick(frame): ViewBox` — given the current frame's data, return the viewBox to apply.
- Subject selection via a pluggable `selectNextSubject(activeTrails, currentSubject)` function. Default impl = `follow-to-finish`.
- All viewBox math: center+zoom → aspect-corrected box; lerp; ease curve for fly-through.

Proposed shape (illustrative, finalize in plan):

```ts
export interface CameraFrame {
  // Screen dimensions, to enforce aspect ratio.
  screenW: number;
  screenH: number;
  nowMs: number;
  // Active trails this frame: index, live cursor position, progress 0..1.
  activeTrails: Array<{ index: number; x: number; y: number; progress: number }>;
}

export interface ViewBox { x: number; y: number; w: number; h: number; }

export interface CinematicConfig {
  mode: "follow";          // only 'follow' implemented now
  zoom: number;            // fraction of screen width visible when following (default 0.25)
  transitionMs: number;    // fly-through duration (default 3000)
  // Off-by-default whip softeners:
  centerLerp: number;      // 0 = pure locked-center (default 0); >0 eases center toward cursor
  velocityZoomOut: number; // 0 = off (default 0); >0 zooms out proportional to cursor speed
}

export class CinematicCamera {
  constructor(config: CinematicConfig);
  tick(frame: CameraFrame): ViewBox;  // returns the viewBox to set this frame
  reset(): void;                      // on loop wrap / trailStates change
}
```

### Camera state machine (cursor-follow)

States: `IDLE → FOLLOWING → FLYING → FOLLOWING → …`

- **Subject pick (`follow-to-finish`):** hold the current subject until its `progress >= 1` (finished) or it's no longer in `activeTrails` (evicted). Then pick a new subject from `activeTrails`, preferring one early in its draw (low `progress`) so the camera rides most of the trail; random tiebreak among near-equal candidates.
- **FOLLOWING:** viewBox centered on the subject's live `(x, y)`, locked dead-center every frame, sized to `zoom` (fraction of screen width visible) with height derived from screen aspect ratio. `centerLerp` and `velocityZoomOut` default to 0 (pure locked-center) and only deviate when explicitly set.
- **FLYING:** when the subject finishes, tween the viewBox from the current box to the next subject's framing over `transitionMs` (default 3000) using an ease curve. The interpolation eases out (zoom out partway), travels across the scene, eases back in — reads as one continuous fly-through. No hard cut, no fade.
- **Fallbacks:**
  - No active trails when a subject is needed → hold the last viewBox until one appears (do not snap to a wide shot; avoids empty-frame churn).
  - Subject evicted mid-follow → treat as finished, fly to a new subject.
  - On animation loop wrap or `trailStates` change → `reset()` so a stale subject from the previous loop doesn't persist.

### Integration into `AnimatedTrails`

- New props: `cinematic?: CinematicConfig | null` and `viewportSize: { width: number; height: number }` (or read from the SVG bounding box if simpler — finalize in plan).
- In the rAF loop, after computing each visible cursor's `cursorPosition`/`trailProgress`, collect them into the `CameraFrame.activeTrails` array (reuse existing per-frame iteration; no second pass).
- When `cinematic` is active, call `camera.tick(frame)` and set `svgRef.viewBox` from the result, **instead of** the document-space viewBox logic. (Cinematic and document-space are mutually exclusive; cinematic wins when both are on.)
- When `cinematic` is null/off, behavior is unchanged.
- Mirror the camera reset into the loop's existing wrap-detection and the `frozen` path.

### Activation & config

URL params, wired through the existing `settingsSpec` headline pattern so they round-trip in share/capture URLs and stay hand-editable:
- `?cinematic=1` or `?cinematic=follow` — enable; mode = follow.
- `?cinemaZoom=0.25` — fraction of screen width visible while following (default 0.25 = tight).
- `?cinemaTransition=3` — fly-through seconds (default 3).
- (Whip softeners `centerLerp` / `velocityZoomOut` available as params too, default 0.)

Keyboard:
- `Shift+C` — toggle cinematic mode live.
- `1` / `2` / `3` — wide / activity / follow mode switches, wired as **stubs**. Only `3` (follow) does anything now; `1`/`2` log "not yet implemented." (Spencer's note: flesh these out into real working switches once the follow feeling is right, to hand-choreograph sequences while recording.)

No Controls-panel UI for now — URL + keyboard only keeps recordings free of chrome.

## Testing

Unit tests (Vitest) for `cinematicCamera.ts`:
- Aspect-ratio correction never stretches: output `w/h` always equals `screenW/screenH` regardless of zoom.
- Pure locked-center: with `centerLerp=0`, the subject's `(x,y)` maps to the viewBox center every frame.
- Fly-through tween: starts at the previous box, ends exactly at the new subject's framing, eases (non-linear), and lasts `transitionMs`.
- Subject re-selection: switches only when the current subject finishes/evicts; `follow-to-finish` prefers low-progress candidates.
- `reset()` clears subject + fly state.

Manual/visual:
- Run the website dev server (`bun run -C extension/website dev` / `vite`), load `live` with `?cinematic=1`, screen-record the camera riding cursors and flying between them.
- If live traffic is too sparse for compelling footage, record the **archive** page pointed at a busy historical day (dense simultaneous cursors) as the primary video. Share video files for review.

## Files touched

- New: `extension/website/shared/utils/cinematicCamera.ts`
- New: `extension/website/shared/utils/__tests__/cinematicCamera.test.ts`
- Edit: `extension/website/shared/components/AnimatedTrails.tsx` — camera instance + viewBox application + keyboard toggle wiring.
- Edit: `extension/website/shared/components/MovementCanvas.tsx` — thread `cinematic` config to AnimatedTrails.
- Edit: `extension/website/shared/config.ts` and/or `shared/utils/settingsSpec.ts` — parse `?cinematic`/`?cinemaZoom`/`?cinemaTransition`.
- Edit: `extension/website/portrait/live.tsx` and `extension/website/archive/archive.tsx` — read cinematic config from URL, pass to MovementCanvas.

No changes under `packages/` → no changeset needed. This is website/experiment code, not public library API or docs.

## Open extension points (for the deferred work)

- `mode` union widens to `"wide" | "activity" | "follow"`; the camera grows a per-mode `tick` branch.
- `selectNextSubject` swaps in intersection-handoff / timed-hop strategies without touching the tween.
- A choreography timeline can sit above the camera, driving `mode` changes over time.
- The pure `CinematicCamera` module can be instantiated per-window for multi-channel, with a coordination layer ensuring different windows pick different subjects.
