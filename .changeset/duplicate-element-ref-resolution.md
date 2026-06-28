---
"@playhtml/common": patch
"playhtml": patch
---

`can-duplicate` and `can-duplicate-to` now accept an element id, an id with a leading `#`, or any CSS selector — the same resolution `can-move-bounds` already used. Previously `can-duplicate="#my-template"` silently failed because the value was passed straight to `getElementById`. Clone ids are now derived from the resolved template element's own id, so a selector or `#`-prefixed value still produces valid clone ids.
