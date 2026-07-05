---
"@playhtml/common": patch
"playhtml": patch
"@playhtml/react": patch
---

Make `can-move-bounds` clamp the full element inside its bounds by default, account for the element's starting position within the bounds container, normalize persisted out-of-bounds positions on mount, and keep fast edge drags pinned while synced position updates catch up. Explicit `min-visible` settings can still allow partial overhang when that behavior is wanted.
