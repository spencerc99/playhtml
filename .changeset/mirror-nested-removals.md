---
"@playhtml/common": patch
"playhtml": patch
---

Mirror nested DOM removals, nested attribute removals, and direct nested text changes from `can-mirror` elements so the full mirrored subtree stays in sync, and rebind locally re-added mirrored capability descendants without duplicate-ID noise.
