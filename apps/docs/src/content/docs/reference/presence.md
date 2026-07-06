---
title: "Presence & identity"
description: "PlayerIdentity, page-level presence channels, element awareness, and isolated presence rooms."
sidebar:
  order: 5
---

Presence is ephemeral per-user state: it clears when someone leaves and does not replay for late joiners. Use [persistent data](/docs/data/data-essentials/) when values should survive a reload.

For usage examples, see [Presence](/docs/data/presence/). For cursor rendering and `CursorOptions`, see [Cursors](/docs/data/presence/cursors/) and [init options](/docs/reference/init-options/#cursors).

---

## `PlayerIdentity`

**Type:** object  
**Persisted:** yes (in `localStorage` per browser; not synced across devices)

```ts
interface PlayerIdentity {
  publicKey: string;
  name?: string;
  playerStyle: {
    colorPalette: string[];
    cursorStyle?: string;
  };
  discoveredSites?: string[];
  createdAt?: number;
}
```

| Field | Notes |
| --- | --- |
| `publicKey` | Stable participant id for this browser. |
| `name` | Display name, if set. |
| `playerStyle.colorPalette` | Cursor colors. Index `0` is the primary color. |
| `playerStyle.cursorStyle` | Optional custom cursor CSS. |

Read your identity with `playhtml.presence.getMyIdentity()` (vanilla) or `usePlayContext().getMyPlayerIdentity()` / `usePlayerIdentity()` (React).

When the "we were online" browser extension is installed, it can inject identity via the `playhtml:configure-identity` DOM event. playhtml merges the extension's color and public key automatically.

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

Channel names become top-level keys on `PresenceView`. Do not collide with system fields (`playerIdentity`, `cursor`, `isMe`) — collisions are dropped.

### `getPresences()`

Returns a snapshot `Map` keyed by connection id. Each value is a `PresenceView`:

```ts
type PresenceView<T = Record<string, unknown>> = {
  playerIdentity?: PlayerIdentity;
  cursor: Cursor | null;
  isMe: boolean;
} & T;
```

Custom channel data appears under the channel name (e.g. `p.status` for channel `"status"`).

### `onPresenceChange(channel, callback)`

Subscribes to changes on one channel. Returns an unsubscribe function. Cursor movement uses channel `"cursor"`.

### `getMyIdentity()`

Returns the local `PlayerIdentity` object.

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

## Element awareness

Presence scoped to one playhtml element. Same lifetime as page presence — ephemeral, no replay.

Set on the [Element API](/docs/reference/element-api/):

| Property / callback field | Role |
| --- | --- |
| `myDefaultAwareness` | Your starting awareness value. |
| `awareness` | Read-only array of every user's value in callbacks. |
| `setMyAwareness` | Broadcast your value. |
| `updateElementAwareness` | Imperative hook when awareness changes. |

Built-in example: `can-hover` uses awareness `{ hover: boolean }` and sets `[data-playhtml-hover]` when anyone hovers.

In React, `withSharedState` / `<CanPlayElement>` expose the same fields on render props: `awareness`, `myAwareness`, `setMyAwareness`.

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

**React hooks:** [`useCursorPresences`](/docs/reference/react-api/#usecursorpresences), [`useCursorZone`](/docs/reference/react-api/#usecursorzone), [`usePlayerIdentity`](/docs/reference/react-api/#useplayeridentity).

**Vanilla:** `playhtml.cursorClient` (advanced; `null` when cursors are disabled). See [playhtml client](/docs/reference/playhtml-client/#cursorclient).

Full cursor config (`room`, `container`, `proximityThreshold`, chat, custom render): [Cursors](/docs/data/presence/cursors/) and [`cursors` init option](/docs/reference/init-options/#cursors).
