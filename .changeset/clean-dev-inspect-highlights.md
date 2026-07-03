---
"@playhtml/common": patch
"playhtml": patch
---

Keep PlayHTML-managed local DOM state out of `can-mirror` persistence, including inspector highlights, devtools labels, loading markers, and hover/focus attributes, so mirrored elements can still be inspected and reset without saving tool UI state.
