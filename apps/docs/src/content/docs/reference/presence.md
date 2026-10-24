---
title: "Presence & identity"
description: "User identity, page-level presence channels, element users, and isolated presence rooms."
sidebar:
  order: 5
---

Presence is ephemeral per-user state: it clears when someone leaves and does not replay for late joiners. Use [persistent data](/docs/data/data-essentials/) when values should survive a reload.

For usage examples, see [Presence](/docs/data/presence/). For cursor rendering and `CursorOptions`, see [Cursors](/docs/data/presence/cursors/) and [init options](/docs/reference/init-options/#cursors).

---

## `User`

**Type:** object

Every API that tells you who someone is uses this shape: [`playhtml.users`](/docs/data/presence/users/), presence views (`p.user`), element users (`users[].user`), cursor views, and the React hooks `useMe()` and `useUsers()`.

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
| `pid` | Stable id for this browser. The same value keys presence and cursor maps. |
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

## Page-level presence (`PresenceAPI`)

Vanilla: `playhtml.presence` (after `playhtml.ready`).  
React: [`usePresence`](/docs/reference/react-api/#usepresence), [`usePresenceRoom`](/docs/reference/react-api/#usepresenceroom).

```ts
interface PresenceAPI {
  setMyPresence(channel: string, data: unknown): void;
  getPresences(): Map<string, PresenceView>;
  onPresenceChange(
    channel: string,
    callback: (presences: Map<string, PresenceView>) => void,
  ): () => void;
  /** @deprecated Use playhtml.users.me */
  getMyIdentity(): PlayerIdentity;
}
```

### `setMyPresence(channel, data)`

Broadcasts a value on a named channel for your user. Pass `null` to clear the channel.

Replace semantics — each call overwrites the previous value for that channel. No partial merge.

```js
playhtml.presence.setMyPresence("status", { text: "focused" });
playhtml.presence.setMyPresence("status", null);
```

Channel names become top-level keys on `PresenceView`. Do not collide with system fields (`user`, `playerIdentity`, `cursor`, `isMe`): `setMyPresence` throws for these names.

### `getPresences()`

Returns a snapshot `Map` keyed by `pid`. Each value is a `PresenceView`:

```ts
type PresenceView<T = Record<string, unknown>> = {
  user?: User;
  /** @deprecated Use user */
  playerIdentity?: PlayerIdentity;
  cursor: Cursor | null;
  isMe: boolean;
} & T;
```

Custom channel data appears under the channel name (e.g. `p.status` for channel `"status"`).

### `onPresenceChange(channel, callback)`

Subscribes to changes on one channel. Returns an unsubscribe function. Cursor movement uses channel `"cursor"`.

### `getMyIdentity()` (deprecated)

Returns the local `PlayerIdentity` object. Use [`playhtml.users.me`](/docs/data/presence/users/) instead, which returns a `User`.

---

## Isolated presence rooms

**Vanilla:** `playhtml.createPresenceRoom(name)` → `{ presence, destroy }`  
**React:** [`usePresenceRoom(name)`](/docs/reference/react-api/#usepresenceroom)

A separate presence scope from the page room (lobby, sidebar, shared document). The `presence` object has the same `PresenceAPI` shape. Call `destroy()` when done to disconnect and clear your presence for others.

```js
const room = playhtml.createPresenceRoom("lobby");
room.presence.setMyPresence("status", { text: "ready" });
room.destroy();
```

---

## Element users

Presence scoped to one playhtml element. Same lifetime as page presence — ephemeral, no replay.

Set on the [Element API](/docs/reference/element-api/):

| Property / callback field | Role |
| --- | --- |
| `live` | Your starting ephemeral value for this element. |
| `users` | Every current user's identity and live value. |
| `setLive` | Broadcast your value. |
| `update` | Render shared data and element users through one callback. |

Built-in example: `can-hover` uses a live `{ hover: boolean }` value and sets `[data-playhtml-hover]` when anyone hovers.

In React, `withSharedState` / `<CanPlayElement>` expose the same `live`, `users`, and `setLive` fields on render props.

---

## Cursor presence

When `cursors: { enabled: true }` is set at init, cursor position and identity are broadcast as presence on channel `"cursor"`.

**Types:**

```ts
type Cursor = {
  x: number;
  y: number;
  pointer: "mouse" | "touch" | string;
};

type CursorPresenceView = {
  cursor: Cursor | null;
  user?: User;
  /** @deprecated Use user */
  playerIdentity?: PlayerIdentity;
  zone?: CursorZonePosition | null;
  page?: string;
};

type CursorZonePosition = {
  zoneId: string;   // matches element.id
  relX: number;     // 0–1 within the zone
  relY: number;
};
```

**React hooks:** [`useCursorPresences`](/docs/reference/react-api/#usecursorpresences), [`useCursorZone`](/docs/reference/react-api/#usecursorzone), [`useMe`](/docs/reference/react-api/#useme).

**Vanilla:** `playhtml.cursorClient` (advanced; `null` when cursors are disabled). See [playhtml client](/docs/reference/playhtml-client/#cursorclient).

Full cursor config (`room`, `container`, `proximityThreshold`, chat, custom render): [Cursors](/docs/data/presence/cursors/) and [`cursors` init option](/docs/reference/init-options/#cursors).
