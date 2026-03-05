# Cursor Pasture — Design Document

**Date:** 2026-03-05
**Experiment:** website/experiments/cursor-pasture (new experiment)
**Foundation:** Builds on experiment 2 ("cursor festival") patterns + native playhtml cursor system

## Concept

A page where every visitor draws their own cursor using a hand-drawing tool, then enters a serene "cursor pasture" — a full-viewport scene where all cursors ever drawn live as little creatures. Online visitors' cursors move around in real-time (via playhtml's native cursor tracking). Offline visitors' cursors perch along a horizon line with creature-like idle animations, occasionally taking flight.

## User Flow

1. **First visit:** A centered overlay appears with a drawing canvas. "Draw your cursor." The pasture scene is visible but dimmed behind it.
2. **Drawing:** User draws with pen tool (perfect-freehand library), picks from a small color palette, can undo strokes or clear. Presses "Done" to save.
3. **Enter pasture:** The overlay closes. The user's hand-drawn cursor replaces their system cursor. They see other online visitors' hand-drawn cursors moving in real-time. The pasture scene shows all cursors ever created.
4. **Return visits:** Identity persisted via `playerIdentity.publicKey` in localStorage. If a matching `CursorDrawing` exists in shared state, skip drawing and enter the pasture directly.
5. **Re-draw:** A subtle button in the corner lets users re-draw their cursor, reopening the drawing overlay.

## Data Model

### Shared State (Yjs, persisted)

```typescript
interface CursorDrawing {
  creatorId: string;        // playerIdentity.publicKey
  strokes: Stroke[];        // SVG path data per stroke
  createdAt: number;        // timestamp
}

interface Stroke {
  color: string;            // hex color
  svgPath: string;          // perfect-freehand path d-attribute
}

// withSharedState defaultData:
{
  cursors: CursorDrawing[]
}
```

### No Custom Awareness Fields

The native playhtml cursor system handles all presence/position tracking via `__playhtml_cursors__`. We use `playerIdentity.publicKey` to link live cursors to their `CursorDrawing` in shared state.

### Identity

Uses playhtml's existing `generatePersistentPlayerIdentity()` which stores identity in localStorage under `playhtml_player_identity`. The `publicKey` field is the stable identifier.

## Drawing Experience

### Canvas

- 128x128 coordinate space HTML canvas
- Displayed at ~300x300 CSS pixels for comfortable drawing
- Transparent background with checkerboard pattern behind to indicate transparency

### Tools

- **Pen:** perfect-freehand library. Captures pointer events (x, y, pressure). On stroke end, runs through `getStroke()` → path string. Stored as `{ color, svgPath }`.
- **Color palette:** 6-8 curated colors that look good as cursors against varied backgrounds. Black default.
- **Undo:** Removes last stroke.
- **Clear:** Removes all strokes, starts over.
- **Done button:** Saves the cursor to shared state and enters the pasture.

No eraser — undo + clear covers practical needs and keeps SVG path storage clean.

### SVG Composition

A utility function composes a `CursorDrawing` into an SVG string:

```
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 128 128">
  <path d="[stroke1.svgPath]" fill="[stroke1.color]"/>
  <path d="[stroke2.svgPath]" fill="[stroke2.color]"/>
</svg>
```

This same SVG is used for:
- CSS `cursor: url("data:image/svg+xml,..."), auto` (own cursor)
- `onCustomCursorRender` output (other users' live cursors)
- Pasture scene cursor images (perched/ghost cursors)

## Pasture Scene

### Visual Layers

1. **Background:** Soft monochrome gradient (warm off-white to pale grey) with subtle texture — CSS noise/grain overlay or paper-like texture. Misty, peaceful. Minimal — cursors are the content.

2. **Horizon / middle ground (lower third):** Perched cursors live here. All `CursorDrawing` entries whose creators are offline sit along this line.
   - Small size (~24-32px)
   - Natural spacing with slight randomness in x-position and y-offset
   - **Idle behaviors:**
     - Subtle CSS keyframe twitches (tiny rotation/shift), each cursor with randomized `animation-delay`
     - Every 15-30s a random perched cursor "takes flight" — animated upward arc, then settles back
   - **Ghost cursors:** Cursors whose creators are currently online. Rendered at ~30% opacity with slight blur. No flights — they're "away" because their spirit is alive in the foreground.

3. **Foreground:** Live cursors from online visitors, handled by playhtml's native cursor system.

### Live Cursor Rendering

- `PlayProvider` initialized with `cursors: { enabled: true, onCustomCursorRender }`.
- `onCustomCursorRender(connectionId, element)` — looks up the connection's `publicKey` from awareness, finds matching `CursorDrawing` in shared state, sets the element's innerHTML to the composed SVG. Returns the element.
- Live cursors rendered at ~40-48px (larger than perched to feel "close").
- Own cursor: `document.body.style.cursor = url(svgDataUrl), auto`.

### Determining Online Status

The awareness array from `withSharedState` provides all online users' data. Cross-reference `CursorDrawing.creatorId` against online `publicKey`s to determine which cursors are alive (ghost in pasture) vs resting (perched with idle animations).

## UI Elements

- **Online count:** Small unobtrusive text in corner — "3 cursors roaming" or similar.
- **Re-draw button:** Subtle, corner-positioned. Opens drawing overlay. Replaces existing `CursorDrawing` in shared state (matched by `creatorId`).
- **Drawing overlay:** Centered card over dimmed pasture. Canvas, color palette, undo/clear buttons, done button.

## Technical Dependencies

- `perfect-freehand` — hand-drawn stroke rendering (new dependency)
- `@playhtml/react` — `PlayProvider`, `withSharedState`, `PlayContext`
- Native playhtml cursor system — `onCustomCursorRender`, awareness, cursor tracking
- React + ReactDOM (consistent with other experiments)

## File Structure

```
website/experiments/cursor-pasture/
  index.html          — HTML shell with #reactContent mount point
  cursor-pasture.tsx  — Main React component
  cursor-pasture.scss — Styles (pasture scene, drawing overlay, animations)
  drawing-canvas.tsx  — Drawing canvas component with perfect-freehand
  pasture-scene.tsx   — Pasture background + perched cursor animations
  svg-utils.ts        — SVG composition utilities
```
