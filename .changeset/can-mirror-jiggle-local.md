---
"playhtml": patch
"@playhtml/common": patch
---

Each playhtml element's random `--jiggle-delay` animation offset is now a valid value, so the staggered jiggle actually applies in browsers. `can-mirror` treats it as local to each visitor: it isn't shared or saved, and applying someone else's styles keeps your own offset.
