---
"@playhtml/common": minor
"playhtml": minor
"@playhtml/react": minor
---

Describe people with one `User` shape (`{ pid, name, color, isMe }`) across the API. Presence views, cursor presence views, and the presence objects passed to `shouldRenderCursor` / `getCursorStyle` now include `user`; `onProximityEntered` receives `user` as a fourth argument; and React adds `useMe()` plus `me` on `usePresence()`. The cursor callbacks `onProximityLeft` and `onCustomCursorRender` now document their first argument as `pid` (the value is unchanged). `playerIdentity` on views, `presence.getMyIdentity()`, `usePresence().myIdentity`, `usePlayerIdentity()`, and `getMyPlayerIdentity()` keep working but are deprecated. `user` is now a reserved presence channel name, so `setMyPresence("user", …)` throws.
