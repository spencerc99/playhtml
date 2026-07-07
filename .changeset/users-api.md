---
"@playhtml/common": minor
"playhtml": minor
"@playhtml/react": minor
---

Add a `playhtml.users` module for durable user identity — name, color, and custom properties — that works whether or not cursors are enabled. `playhtml.users.me` exposes your own identity (`name`, `color`, `pid`, `custom`), with setters that persist and publish to the room; `me.setCustom(key, value, { persist })` merges a single custom key (`persist: false` syncs it live without saving it across reloads, and setting a value to `undefined` deletes the key). `playhtml.users.getAll()` returns everyone currently in the room, and `playhtml.users.onChange(callback)` subscribes to join/leave/identity changes. Custom properties are JSON-serializable data capped at 1KB once serialized, and they sync to everyone in the room — when cursors are enabled, they arrive on other clients as `presence.playerIdentity.custom` in cursor render hooks like `getCursorStyle` and `shouldRenderCursor`.

`window.cursors.custom` and `window.cursors.setCustom` remain available as conveniences that delegate to `playhtml.users.me`. In React, the new `useUsers()` hook gives a reactive live roster, and `usePlayerIdentity()` now returns `custom` alongside `name`, `color`, and `pid` without requiring `cursors: { enabled: true }`.
