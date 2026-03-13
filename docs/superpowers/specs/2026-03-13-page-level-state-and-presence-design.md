# Page-Level Shared State and Presence API

Date: 2026-03-13

## Problem

playhtml ties all shared data and awareness to specific DOM elements via `can-play` / `ElementHandler`. There is no way to:

1. Share persistent state at the page level without creating a hidden dummy element
2. Set or read custom per-user ephemeral fields (e.g., "following", "navigatingTo") without reaching into Yjs awareness internals
3. Access a unified view of all users (identity + cursor + custom fields) through a single API

These gaps force consumers (e.g., the browser extension) to use workarounds: hidden elements for page data, raw `awareness.setLocalStateField()` for custom fields, and no clean way to get a combined user view.

## Design

Two new API surfaces on the `playhtml` object:

### 1. Page-Level Shared Data: `playhtml.createPageData()`

Named channels for persistent, Yjs-backed shared state not tied to any DOM element.

#### API

```ts
playhtml.createPageData<T>(name: string, defaultValue: T): PageDataChannel<T>

interface PageDataChannel<T> {
  getData(): T
  setData(mutator: (draft: T) => void): void   // CRDT-safe mutation via proxy
  setData(value: T): void                       // full replacement
  onUpdate(callback: (data: T) => void): () => void  // returns unsubscribe fn
  destroy(): void                               // remove listeners, clean up
}
```

#### Usage

```ts
const glows = playhtml.createPageData("link-glows", {
  links: {} as Record<string, { count: number; recentColors: string[] }>,
  totalClicks: 0,
});

glows.setData((draft) => {
  draft.links[path] ??= { count: 0, recentColors: [] };
  draft.links[path].count += 1;
});

const unsub = glows.onUpdate((data) => {
  renderGlows(data);
});

// React hook equivalent (in @playhtml/react):
// const [data, setData] = usePageData("link-glows", defaultValue);
```

#### Internals

- Page data lives at `store.play["__page__"][channelName]` in the existing SyncedStore.
- `"__page__"` is a reserved tag name. `createPageData` initializes `store.play["__page__"]` and the proxy directly (via `ensureElementProxy`), bypassing `maybeSetupTag`. `maybeSetupTag` should throw if someone tries to use `"__page__"` as an element tag to prevent collisions.
- `createPageData` calls `ensureElementProxy("__page__", name, defaultValue)` and attaches a SyncedStore deep observer, reusing the same machinery as element handlers.
- `setData` with a mutator wraps the call in `doc.transact()` and mutates the proxy directly (same as `ElementHandler.onChange` mutator form). Uses `typeof data === "function"` to discriminate mutator vs. value form.
- `setData` with a value calls `deepReplaceIntoProxy(proxy, value)` inside a transaction (same as `ElementHandler.onChange` value form).
- `onUpdate` fires on all changes (local and remote), matching element handler behavior. The callback receives a cloned plain snapshot. Consumers that need to distinguish local vs. remote changes should track their own writes.
- Multiple calls to `createPageData` with the same name return independent channel handles pointing to the same underlying proxy (shared data, independent listeners).
- Each channel handle maintains its own list of `onUpdate` listeners. `destroy()` removes only that handle's listeners. The underlying proxy and SyncedStore observer persist as long as any handle exists. A reference count on the observer tracks active handles; when the last handle is destroyed, the observer is removed from `yObserverByKey` and the proxy entry is cleaned up from `proxyByTagAndId`.

### 2. Presence API: `playhtml.presence`

Unified per-user presence with custom ephemeral fields, always available after `init()`.

#### API

```ts
playhtml.presence: PresenceAPI

interface PresenceAPI {
  setMyPresence(channel: string, data: unknown): void   // replace semantics per channel
  getPresences(): Map<string, PresenceView>
  onPresenceChange(
    callback: (presences: Map<string, PresenceView>) => void
  ): () => void    // returns unsubscribe fn
  getMyIdentity(): PlayerIdentity
}

// System fields are always typed. Custom presence channels are flattened
// into the top level via intersection. Channels that collide with system
// field names ("playerIdentity", "cursor") are silently dropped.
type PresenceView<T extends Record<string, unknown> = Record<string, unknown>> = {
  playerIdentity?: PlayerIdentity
  cursor: Cursor | null
} & T
```

#### Usage

```ts
// Set named presence channels (replace semantics, like setData)
playhtml.presence.setMyPresence("follow", { targetId: "abc123" });
playhtml.presence.setMyPresence("navigation", { url: "/wiki/Foo", title: "Foo" });

// Read all users' presence (system fields + custom channels flattened)
const presences = playhtml.presence.getPresences();
for (const [id, p] of presences) {
  p.cursor           // Cursor | null — always typed
  p.playerIdentity   // PlayerIdentity — always typed
  p.follow           // { targetId: "abc123" } — custom channel
  p.navigation       // { url: string, title: string } — custom channel
}

// Subscribe to changes
const unsub = playhtml.presence.onPresenceChange((presences) => {
  updateFollowerList(presences);
});

// Get own identity
const me = playhtml.presence.getMyIdentity();

// Clear a channel by setting to null
playhtml.presence.setMyPresence("navigation", null);
```

#### Internals

- `playhtml.presence` is always available after `init()`, regardless of cursor config.
- It delegates to whichever awareness provider exists: the cursor provider if cursors are enabled (and it uses a different room), or the main `yprovider` otherwise. This means presence is scoped to the same room as the provider it uses. When cursors use a different room (e.g., domain-wide), presence follows cursors (domain-wide). When cursors are disabled, presence follows element data (page-scoped). This matches the existing awareness topology and does not introduce merging across providers.
- `setMyPresence(channel, data)` uses **replace** semantics per channel, consistent with `ElementHandler.setMyAwareness` and `setData`. Each channel name maps to its own key in the awareness state. Setting data to `null` removes the channel. Internally: calls `awareness.setLocalStateField("__presence__", { ...currentPresence, [channel]: data })` (or removes the key if `null`). `"__presence__"` is a reserved awareness field name (like `__playhtml_cursors__` for cursor data). Cursors are internally the `"__cursors__"` channel on the same system — custom channels follow the same pattern.
- `getPresences()` reads all awareness states and builds a `PresenceView` per user:
  - `playerIdentity` from existing cursor presence data or the identity system
  - `cursor` from `__playhtml_cursors__` field (null if cursors disabled or no position)
  - Custom channels from `__presence__` field, flattened into the top-level object. Channels whose names collide with system fields (`playerIdentity`, `cursor`) are silently dropped.
  - Keyed by stable ID (via `getStableIdForAwareness`)
  - Excludes self (the local user). Use `getMyIdentity()` for local user info.
- `onPresenceChange` adds a listener to the awareness `change` event. On change, rebuilds the presences map and calls the callback. Uses fingerprinting to avoid redundant callbacks (same approach as current cursor presence listeners).
- `getMyIdentity()` delegates to existing `generatePersistentPlayerIdentity()` / `getMyPlayerIdentity()`.

#### Cursor data in PresenceView

- `cursor` is typed as `Cursor | null` always.
- When cursors are enabled: `cursor` contains position data (may still be null if user hasn't moved yet).
- When cursors are disabled: `cursor` is always null.
- Cursor coordinate conversion (storage to client) is handled internally, same as `getCursorPresences()` does today.

### 3. Backward Compatibility: `playhtml.cursorClient`

- `playhtml.cursorClient` remains as a deprecated getter returning the existing `CursorClientAwareness` instance.
- All existing `cursorClient` methods continue to work (`getCursorPresences()`, `onCursorPresencesChange()`, `getMyPlayerIdentity()`, `getProvider()`, cursor zones, etc.).
- No migration required for existing consumers. New code should use `playhtml.presence`.

## Future Direction

This design is a stepping stone toward separating presence from cursor rendering:

```
PresenceClient (generic: identity, custom fields, awareness)
  +-- CursorRenderer (opt-in: visual cursor rendering, zones, spring animation)
```

The `playhtml.presence` API surface is designed to survive that refactor unchanged. When the refactor happens:
- `playhtml.presence` continues to work identically
- `playhtml.cursorClient` is removed (or kept as a deeper deprecated alias)
- Cursor rendering becomes a layer that consumes presence data rather than owning it

## Scope

This spec covers changes to the core `playhtml` package only:

- `packages/playhtml/src/index.ts` — new API surface, `createPageData`, presence object
- `packages/common/src/index.ts` — new types (`PageDataChannel`, `PresenceAPI`, `PresenceView`)
- React hooks (`usePageData`) are a follow-up, not part of this change.

## What This Does NOT Include

- Refactoring `CursorClientAwareness` into a generic `PresenceClient`
- Room scoping for presence independent of element data room
- React integration (`usePageData` hook, presence hooks)
- Changes to the PartyKit server
