---
"playhtml": patch
---

Keep `playhtml.init()` options static after the first initialization. For SPA room changes, use the default URL-derived room or pass a function-valued `room` so `handleNavigation()` can recompute it on route changes.
