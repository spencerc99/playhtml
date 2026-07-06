---
"@playhtml/common": patch
---

Iterate element attributes via `Array.from` in `canMirror` element-state capture so the code type-checks under TypeScript configs that lack `NamedNodeMap` iterator support (no `downlevelIteration`/`DOM.Iterable`). No runtime behavior change.
