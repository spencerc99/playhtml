---
"playhtml": patch
"@playhtml/react": patch
---

Defer loading the development toolbar until development mode is enabled so production runtime bundles do not include that code path.
Keep the React package test bootstrap aligned with the current playhtml configuration API.
