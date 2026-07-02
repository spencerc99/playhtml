---
"@playhtml/common": patch
"playhtml": patch
"@playhtml/react": patch
---

Make `can-move-bounds` clamp the full element inside its bounds by default and account for the element's starting position within the bounds container. Explicit `min-visible` settings can still allow partial overhang when that behavior is wanted.
