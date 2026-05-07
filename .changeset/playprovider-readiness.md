---
"playhtml": minor
"@playhtml/react": patch
---

Add `playhtml.ready` and `playhtml.isLoading` as public lifecycle signals. Concurrent `playhtml.init()` calls now share the same readiness promise, so multiple React roots can safely mount providers without one root marking itself ready before the singleton has finished syncing.

`<PlayProvider>` still bootstraps playhtml when rendered with or without `initOptions`, preserving the existing bare-provider behavior while using the shared readiness signal for React context loading state.
