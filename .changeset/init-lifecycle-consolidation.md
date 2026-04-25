---
"playhtml": minor
"@playhtml/react": minor
---

Consolidate the init lifecycle around a single `isLoading` boolean and a `playhtml.ready` promise, and split `<PlayProvider>` into init-owning and context-only modes.

**Core (`playhtml`):**

- Adds `playhtml.isLoading` (true until init's setup wiring completes, false thereafter) and `playhtml.ready: Promise<void>` (resolves once when isLoading flips false; concurrent `init()` callers all await the same promise).
- Removes the internal `firstSetup` flag entirely; renames the bistable `hasSynced` (which is reset during `handleNavigation`) to `mainRoomSynced` since the public-facing meaning is now `isLoading`.
- `createPresenceRoom` now gates on `isLoading` instead of the bistable `hasSynced`. Presence rooms have their own provider independent of the main room, so they no longer race with `handleNavigation`.
- `init()` is fully idempotent and dedupes concurrent in-process callers via a shared `_ready` promise.
- Adds a 10s safety timeout on the main-room sync await — if the WebSocket never connects, init still resolves with a warning so consumers aren't stuck on `playhtml.ready` forever.

**React (`@playhtml/react`):**

- `<PlayProvider>` now has two explicit modes:
  - **Init-owning**: rendered with `initOptions`. Calls `playhtml.init()` on mount. Use once at your app root.
  - **Context-only**: rendered without `initOptions`. Does not call init — relays state from the global playhtml singleton. Use in additional React roots (e.g. Astro islands).
- Multiple init-owning providers log a one-time warning, since `playhtml.init()` is idempotent and silently drops late options.
- Drops the previous behavior of flipping `hasSynced=true` on `init()` rejection — `playhtml.ready` either resolves cleanly or stays pending. UI stays in loading state on transient failures.
- Context still exposes both `isLoading` (canonical) and `hasSynced` (deprecated alias = `!isLoading`).

This fixes intermittent `playhtml.createPresenceRoom is not available before init()` errors that surfaced when:
- Multiple `<PlayProvider>` instances mounted concurrently (Astro islands pattern) and one early-returned from `init()` while another was still bootstrapping.
- `handleNavigation()` cleared the internal sync flag mid-flight.
- `init()` failed transiently and the React provider unblocked downstream hooks anyway.
