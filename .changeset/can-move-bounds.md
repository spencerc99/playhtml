---
"playhtml": minor
"@playhtml/common": minor
---

`can-move` now supports a declarative `can-move-bounds` attribute that clamps a draggable element to a specific container. Set the value to the container's id (`can-move-bounds="arena"` or `can-move-bounds="#arena"`) or any CSS selector. The element can partially hang off the container edges — by default 25% of the element stays inside so it remains grabbable — while the cursor itself is unconstrained and a fast drag past the edge won't fling the element back in the opposite direction.

Override the keep-visible fraction with `can-move-bounds-min-visible` (0 to 1). Use `1` to pin the element fully inside (the legacy "strict clamp" behavior), `0` to let it slip out of view entirely, or any value in between.

```html
<div id="fridge">
  <div can-move can-move-bounds="fridge" id="magnet-a">🍎</div>
  <div can-move can-move-bounds="#fridge" can-move-bounds-min-visible="0.5" id="magnet-b">🥐</div>
</div>
```

Exported from `@playhtml/common`: `CanMoveBounds`, `CanMoveBoundsMinVisible`.
