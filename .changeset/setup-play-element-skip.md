---
"playhtml": patch
---

Fix `setupPlayElement(..., { ignoreIfAlreadySetup: true })` so it actually skips elements that are already registered.
