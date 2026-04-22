---
"playhtml": minor
"@playhtml/common": minor
---

`can-move` now supports a declarative `can-move-bounds` attribute that clamps a draggable element to a specific container. Set the value to the container's id (`can-move-bounds="arena"` or `can-move-bounds="#arena"`) or any CSS selector. The element can partially hang off the container edges — by default `max(25% of element size, 60px)` stays inside on every edge so readers always have something to grab — while the cursor itself is unconstrained and a fast drag past the edge won't fling the element back in the opposite direction.

Tune the keep-visible slice with two optional attributes:

- `can-move-bounds-min-visible` (0–1) — fraction of the element to keep visible. Use `1` to pin fully inside (legacy strict clamp), `0` to drop the fraction constraint.
- `can-move-bounds-min-visible-px` (pixels, default 60) — absolute floor, useful when an image has transparent padding that would otherwise let the visible paint slip out. The effective slice is `max(fraction × size, pxFloor)`.

Set both to `0` to opt fully out of the keep-visible guarantee.

```html
<div id="fridge">
  <div can-move can-move-bounds="fridge" id="magnet-a">🍎</div>
  <div can-move can-move-bounds="#fridge"
       can-move-bounds-min-visible="0.5"
       can-move-bounds-min-visible-px="0"
       id="magnet-b">🥐</div>
</div>
```

Exported from `@playhtml/common`: `CanMoveBounds`, `CanMoveBoundsMinVisible`, `CanMoveBoundsMinVisiblePx`.
