---
"playhtml": minor
"@playhtml/common": minor
---

Add `playhtml.createPresenceRoom(name)` — creates a domain-scoped presence-only room connection. Returns a `PresenceRoom` with a `PresenceAPI` instance and a `destroy()` cleanup function. Useful for cross-page coordination like lobbies, page directories, and ambient social awareness without cursor rendering overhead.
