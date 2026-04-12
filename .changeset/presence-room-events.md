---
"playhtml": minor
"@playhtml/common": minor
"@playhtml/react": minor
---

Add dispatchEvent/onEvent to PresenceRoom and playhtml for cleaner event API

- `room.dispatchEvent(type, payload?)` and `room.onEvent(type, callback)` for domain-scoped events via PresenceRoom
- `playhtml.dispatchEvent(type, payload?)` and `playhtml.onEvent(type, callback)` for page-scoped events
- `onEvent` returns an unsubscribe function directly (no ID tracking needed)
- Deprecate `dispatchPlayEvent`, `registerPlayEventListener`, `removePlayEventListener` (still functional, no breaking change)
