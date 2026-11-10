---
"playhtml": patch
"@playhtml/common": patch
---

`can-mirror` sends and computes much less. Typing in an input inside a mirrored element now syncs only that input's value, instead of re-sending the whole element on every keystroke (about 38KB per key with 200 siblings, now a few dozen bytes). Adding or removing a child syncs only the children that changed, instead of the whole list, and adding many children at once no longer freezes the page (200 appends went from about 1s to about 40ms).
