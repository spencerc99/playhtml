---
"@playhtml/common": minor
"playhtml": minor
"@playhtml/react": minor
---

Add a `playhtml.users` module for durable user identity (name and color) that works whether or not cursors are enabled. `playhtml.users.me` exposes your own identity (`name`, `color`, `pid`) with setters that persist and publish to the room. `playhtml.users.getAll()` returns an array of everyone currently in the room, and `playhtml.users.onChange(callback)` subscribes to join/leave/identity changes. In React, the new `useUsers()` hook gives a reactive roster, and `usePlayerIdentity()` no longer requires `cursors: { enabled: true }`.

Identity now lives in one place: `window.cursors.color` and `window.cursors.name` are thin delegates to `playhtml.users.me`, `window.cursors.allColors` is derived from the room's users (its undocumented setter is removed), identity changes republish to peers (previously a name or color change on a page without cursors never reached other visitors), and the browser extension's injected identity is adopted without cursors enabled. `playhtml.elementHandlers` remains available for compatibility but is deprecated; use `playhtml.getHandle(elementId, tag)` to interact with a bound element.
