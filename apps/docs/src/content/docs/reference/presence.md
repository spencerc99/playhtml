---
title: "Presence & identity"
description: "User identity, page and element presence, cursors, and isolated presence rooms."
sidebar:
  order: 5
---

Presence is per-person state: it clears when someone leaves and does not replay for late joiners. Use [persistent data](/docs/data/data-essentials/) when values should survive a reload.

For usage examples, see [Presence](/docs/data/presence/). For cursor rendering and `CursorOptions`, see [Cursors](/docs/data/presence/cursors/) and [init options](/docs/reference/init-options/#cursors).

---

## `User`

**Type:** object

Every API that tells you who someone is uses this shape: [`playhtml.users`](/docs/data/presence/users/), presence entries (`everyone[].user`), cursor entries, and the React hooks `useMe()` and `useUsers()`.

```ts
type User = {
  pid: string;
  name?: string;
  color: string;
  isMe: boolean;
};
```

| Field | Notes |
| --- | --- |
| `pid` | Stable id for this browser. Use it as a React `key` or to match people across lists. |
| `name` | Display name, if set. |
| `color` | Primary color. |
| `isMe` | `true` for your own entry. |

Read yourself with `playhtml.users.me` (vanilla) or `useMe()` (React). Set `name` and `color` by assigning to `playhtml.users.me`. Identity persists in `localStorage` per browser and is not synced across devices.

### `PlayerIdentity` (advanced)

`PlayerIdentity` is the lower-level object playhtml stores and sends. You only need it to seed identity with the `cursors.playerIdentity` init option or to set a custom cursor style. Everywhere else, prefer `User`. `publicKey` is the same value as `pid`, and `playerStyle.colorPalette[0]` is `color`.

```ts
interface PlayerIdentity {
  publicKey: string;
  name?: string;
  playerStyle: {
    colorPalette: string[];
    cursorStyle?: string;
  };
  createdAt?: number;
}
```

Keep private keys, local profile data, and browsing history in your own app storage instead of adding them to this object.

When the "we were online" browser extension is installed, it can inject identity via the `playhtml:configure-identity` DOM event. playhtml merges the extension's color and `pid` automatically.

---

## `PresenceEntry`

Every list of people's presence uses this shape: `playhtml.page.getEveryone()`, a presence room's `getEveryone()`, and an element's `everyone`.

```ts
type PresenceEntry<V> = {
  user: User;
  presence: V;
};
```

Lists include you (`user.isMe`) and are in join order. For everyone but you: `everyone.filter(({ user }) => !user.isMe)`.

---

## Page presence (`playhtml.page`)

Vanilla: `playhtml.page` (after `playhtml.ready`).  
React: [`usePagePresence`](/docs/reference/react-api/#usepagepresence).

Each person has one presence object (`PagePresence = Record<string, unknown>`).

```ts
interface PresenceScope {
  getEveryone(): PresenceEntry<PagePresence>[];
  getEveryone<V>(key: string): PresenceEntry<V | undefined>[];
  setPresence(partial: PagePresence): void;
  onPresenceChange(callback): () => void;
  onPresenceChange(key: string, callback): () => void;
  onPresenceChange(select: (presence: PagePresence) => S, callback): () => void;
}
```

### `setPresence(partial)`

Merges top-level keys into your presence. `null` or `undefined` removes a key. Values inside a key replace (no deep merge). Throws for a non-object, for `"cursor"` (use [`users.cursors`](#cursors-userscursors)), and for the reserved keys `user`, `playerIdentity`, and `isMe`.

```js
playhtml.page.setPresence({ status: { text: "focused" } });
playhtml.page.setPresence({ status: null });
```

Writes are rate limited per person (about 20 per second); extra writes are dropped. Use presence for state changes, and cursors for pointer position. With `developmentMode`, playhtml warns once when you exceed the limit.

### `getEveryone(key?)`

Returns everyone's presence. With a key, each entry's `presence` is just that key's value.

### `onPresenceChange(keyOrSelect?, callback)`

Calls `callback(everyone)` right away, then whenever the watched part changes. Returns an unsubscribe function.

- No first argument: watches the whole presence object.
- A key: watches one key; entries carry that key's value.
- A selector: watches `select(presence)`; entries carry the selection. Return a primitive or a small object, since the callback fires whenever the selection's value changes.

---

## Isolated presence rooms

**Vanilla:** `playhtml.createPresenceRoom(name)` returns a room with the same `getEveryone`, `setPresence`, and `onPresenceChange` as `playhtml.page`, plus `destroy()`.  
**React:** [`usePresenceRoom(name)`](/docs/reference/react-api/#usepresenceroom)

A separate presence scope from the page (lobby, sidebar, shared document). Call `destroy()` when done to disconnect and clear your presence for others.

```js
const room = playhtml.createPresenceRoom("lobby");
room.setPresence({ status: { text: "ready" } });
room.destroy();
```

---

## Element presence

Presence scoped to one playhtml element. Same lifetime as page presence.

Set on the [Element API](/docs/reference/element-api/):

| Property / callback field | Role |
| --- | --- |
| `presence` | Your starting value for this element. |
| `myPresence` | Your current value. |
| `everyone` | `PresenceEntry[]` for everyone with the element on screen. |
| `setPresence` | Replace your value. |
| `update` | Render shared data and presence through one callback. |

From outside the element, use its handle: `getHandle(id).getMyPresence()`, `.getEveryone()`, `.setPresence(v)`, and `.onPresenceChange(select?, callback)` (works before the element exists).

Built-in example: `can-hover` uses a `{ hover: boolean }` presence and sets `[data-playhtml-hover]` when anyone hovers.

In React, `withSharedState` / `<CanPlayElement>` expose the same `myPresence`, `everyone`, and `setPresence` fields on render props.

---

## Cursors (`users.cursors`)

When `cursors: { enabled: true }` is set at init, read everyone's cursors from `playhtml.users.cursors` (React: [`useCursors`](/docs/reference/react-api/#usecursors)).

```ts
interface UsersCursorsAPI {
  getAll(): CursorEntry[];
  onChange(callback: (cursors: CursorEntry[]) => void): () => void;
}

type CursorEntry = {
  user: User;
  cursor: Cursor | null;
  zone?: CursorZonePosition | null;
  page?: string;
};
```

`getAll()` returns an empty list when cursors are disabled. `onChange` fires right away and then on every cursor move.

---

## Deprecated

These keep working. New code should use the APIs above.

| Deprecated | Use |
| --- | --- |
| `playhtml.presence` (`PresenceAPI`: `setMyPresence`, `getPresences`, `onPresenceChange`, `getMyIdentity`) | `playhtml.page`, `playhtml.users.me`, `playhtml.users.cursors` |
| `PresenceView` (pid-keyed `Map` of flattened channels) | `PresenceEntry` |
| `room.presence` | the same methods on `room` |
| Element `live`, `setLive`, `getLive`, `users` | `presence`, `setPresence`, `getMyPresence`, `everyone` |
| Element `awareness`, `myAwareness`, `setMyAwareness`, `myDefaultAwareness`, `awarenessByStableId` | `everyone`, `myPresence`, `setPresence`, `presence` |
| `playhtml.cursorClient.getCursorPresences()`, `CursorPresenceView` | `playhtml.users.cursors.getAll()`, `CursorEntry` |

With `developmentMode`, playhtml logs a one-time notice the first time you use a deprecated name (except the element `live` names and `window.cursors`).

---

## Cursor rendering

Cursor position types, shared by `CursorEntry`:

```ts
type Cursor = {
  x: number;
  y: number;
  pointer: "mouse" | "touch" | string;
};

type CursorZonePosition = {
  zoneId: string;   // matches element.id
  relX: number;     // 0–1 within the zone
  relY: number;
};
```

**React hooks:** [`useCursors`](/docs/reference/react-api/#usecursors), [`useCursorZone`](/docs/reference/react-api/#usecursorzone), [`useMe`](/docs/reference/react-api/#useme).

Full cursor config (`room`, `container`, `proximityThreshold`, chat, custom render): [Cursors](/docs/data/presence/cursors/) and [`cursors` init option](/docs/reference/init-options/#cursors).
