---
"@playhtml/common": minor
"playhtml": minor
"@playhtml/react": minor
---

Add `isLoading` and `onLoadingChange` to `PresenceRoom` so consumers can gate `dispatchEvent` on the room's own WebSocket sync state (separate from the page's sync state). `usePresenceRoom` now returns `{ room, isLoading }` where `isLoading` combines playhtml's load state with the room's own.
