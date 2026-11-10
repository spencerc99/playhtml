---
"playhtml": patch
"@playhtml/common": patch
---

`can-mirror` sends much less data. Typing in an input inside a mirrored element now syncs only that input's value, instead of re-sending the whole element on every keystroke (about 38KB per key with 200 siblings, now a few dozen bytes). Adding or removing a child syncs only the children that changed, instead of the whole list.
