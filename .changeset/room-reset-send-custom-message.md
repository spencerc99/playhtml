---
---

fix(partykit): broadcast the `room-reset` message to stale clients via `sendCustomMessage` so it carries partyserver's `__YPS:` prefix. Without the prefix, the client-side `provider.on("custom-message", ...)` handler silently dropped the signal, leaving stale clients unable to receive the reset and reload.
