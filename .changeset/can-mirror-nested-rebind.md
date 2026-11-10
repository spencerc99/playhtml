---
"playhtml": patch
---

When a `can-mirror` element contains other playhtml elements, updates to the outer element no longer rebuild every inner element's handler. Inner elements that are still bound just re-apply their own shared data, which cuts the work done on each update of the outer element by about a third on a page with 200 nested elements.
