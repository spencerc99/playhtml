---
"playhtml": patch
---

`cursorClient.configure({ playerIdentity })` now emits `color` and `name` events when the identity's color or name changes, mirroring the `window.cursors` setters. This makes identity injected through `configure()` — including the extension's `playhtml:configure-identity` bridge — reactively update subscribers (e.g. the React context behind `usePlayerIdentity()`), instead of silently changing only the internal state.
