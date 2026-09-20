---
"playhtml": patch
---

Allow nullable page data to be cleared with `setData(null)` or an updater returning `null` after holding an object or array. Subscribers receive the cleared value, and the channel can be populated again.
