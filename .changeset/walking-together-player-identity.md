---
"@playhtml/react": minor
---

Add `usePlayerIdentity()` hook, which returns the local player's `{ color, pid, name }` from the playhtml context. Values update reactively, including when an external source (such as the "we were online" extension) injects identity via the `playhtml:configure-identity` event. Requires `PlayProvider` with cursors enabled.
