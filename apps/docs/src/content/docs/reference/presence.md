---
title: "People & presence"
description: "playhtml.people, the Person shape, page and element presence, cursors, and presence rooms."
sidebar:
  order: 5
---

Presence is per-person state: it clears when someone leaves and does not replay for people who arrive later. Use [saved data](/docs/concepts/) when values should survive a reload.

For usage examples, see [people and presence](/docs/data/presence/). For cursor rendering and `CursorOptions`, see [Cursors](/docs/advanced/cursors/) and [init options](/docs/reference/init-options/#cursors).

---

## `Person`

**Type:** object

Every list of people uses this shape: `playhtml.people.everyone`, a room's `people.everyone`, and an element's `everyone`.

```ts
type Person<P = PagePresence> = {
  pid: string;
  name?: string;
  color: string;
  isMe: boolean;
  presence: P;
};
```

| Field | Notes |
| --- | --- |
| `pid` | Stable id for this person in this browser. Use it as a React `key` or to match people across lists. |
| `name` | Display name, if set. Saved, follows the person between visits. |
| `color` | Their color. Saved, follows the person between visits. |
| `isMe` | `true` for you. |
| `presence` | What they're doing right now. On the page, a `PagePresence` object; on an element, that element's presence value. |

Lists include you and are in join order. For everyone but you: `everyone.filter((person) => !person.isMe)`.

The same person has the same `pid`, `name`, and `color` everywhere; only `presence` depends on where you read it. Identity is saved in `localStorage` per browser and is not synced across devices.

### `PlayerIdentity` (advanced)

`PlayerIdentity` is the lower-level object playhtml stores and sends. You only need it to seed identity with the `cursors.playerIdentity` init option or to set a custom cursor style. Everywhere else, use `Person`. `publicKey` is the same value as `pid`, and `playerStyle.colorPalette[0]` is `color`.

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

## `playhtml.people`

Vanilla: `playhtml.people` (after `playhtml.ready`).  
React: [`usePeople`](/docs/reference/react-api/#usepeople), or `usePlayContext().people`.

```ts
interface People {
  readonly everyone: Person[];
  readonly me: Me;
  getAll(): Person[]; // same as everyone
  setMyPresence(key: string, value: unknown): void;
  onChange(callback: (everyone: Person[]) => void): () => void;
  onChange(keys: string | string[], callback: (everyone: Person[]) => void): () => void;
}

type PagePresence = Record<string, unknown> & { cursor?: PersonCursor };
```

### `everyone`

Everyone on the page right now, including you, in join order. Each read builds a fresh list.

### `me`

You, as a `Person`. Assigning `me.name` or `me.color` saves the change and shows it to everyone (and updates your cursor, if cursors are on). `me.presence` is your current page presence; it's read-only, so write with `setMyPresence`.

```js
playhtml.people.me.name = "Ana";
playhtml.people.me.color = "#3b82f6";
playhtml.people.me.presence.status;
```

### `setMyPresence(key, value)`

Sets one key of your page presence and keeps the others. `null` removes the key. The value replaces the key's old value whole (no deep merge). Throws for `"cursor"` (playhtml sets it) and for the reserved keys `user`, `playerIdentity`, and `isMe`.

```js
playhtml.people.setMyPresence("status", { text: "focused" });
playhtml.people.setMyPresence("status", null);
```

Writes are rate limited per person (about 20 per second); extra writes are dropped. Use presence for state changes; cursors already share pointer position. With `developmentMode`, playhtml warns once when you exceed the limit.

### `onChange(keys?, callback)`

Calls `callback(everyone)` right away, then whenever someone joins or leaves, changes their name or color, or changes their presence. Returns an unsubscribe function.

- No keys: fires on any presence change except cursor moves.
- A key or a list of keys: fires only when those keys change (plus joins, leaves, name and color changes).
- `"cursor"` in the keys: also fires on cursor moves.

### `PersonCursor`

When cursors are enabled, each person's `presence.cursor` is where their pointer is, or missing when it isn't on the page.

```ts
type PersonCursor = {
  x: number;
  y: number;
  pointer: "mouse" | "touch" | string;
  zone?: CursorZonePosition | null; // the cursor zone it's in
  page?: string;                    // the page it's on
};

type CursorZonePosition = {
  zoneId: string;   // matches element.id
  relX: number;     // 0–1 within the zone
  relY: number;
};
```

---

## Presence rooms

**Vanilla:** `playhtml.createPresenceRoom(name)` returns `{ people, destroy }`. `room.people` has the same API as `playhtml.people`, scoped to the room, without cursors.  
**React:** [`usePresenceRoom(name)`](/docs/reference/react-api/#usepresenceroom)

A separate presence scope from the page (lobby, sidebar, shared document). Your `pid`, `name`, and `color` are the same in every room. Call `destroy()` when done to disconnect and clear your presence for others.

```js
const room = playhtml.createPresenceRoom("lobby");
room.people.setMyPresence("status", { text: "ready" });
room.people.everyone;
room.destroy();
```

---

## Element presence

Presence scoped to one playhtml element. Same lifetime as page presence.

Set on the [Element API](/docs/reference/element-api/):

| Property / callback field | Role |
| --- | --- |
| `defaultPresence` | Your starting value for this element. |
| `everyone` | `Person[]` for everyone with the element on screen; `presence` is their value for this element. |
| `me` | You, with your value at `me.presence`. |
| `setMyPresence(next)` | Sets your value: the whole value, or a function that edits a copy (like `setData`). |
| `update` | Renders shared data and presence through one callback. |

In `onMount`, read them with `getEveryone()` and `getMe()`, since they change after mount.

From outside the element, use its handle with the same names: `getHandle(id).everyone`, `.me`, `.setMyPresence(next)`, and `.onEveryoneChange(keys?, callback)`, which works before the element exists.

Built-in example: `can-hover` uses a `{ hover: boolean }` presence and sets `[data-playhtml-hover]` when anyone hovers.

In React, `withSharedState` / `<CanPlayElement>` expose the same `everyone`, `me`, and `setMyPresence` fields on render props.

---

## Deprecated

These keep working. New code should use the APIs above.

| Deprecated | Use |
| --- | --- |
| `playhtml.users` (`me`, `getAll()`, `onChange()`), `User` | `playhtml.people` (`me`, `everyone`, `onChange()`), `Person` |
| `playhtml.presence` (`setMyPresence`, `getPresences`, `onPresenceChange`, `getMyIdentity`), `PresenceView` | `playhtml.people` |
| `room.presence` | `room.people` |
| `playhtml.cursorClient.getCursorPresences()`, `CursorPresenceView` | `person.presence.cursor` |
| Element `live: {...}`, `myDefaultAwareness` | `defaultPresence` |
| Element `live`, `myAwareness`, `getLive()` | `me.presence`, `getMe().presence` |
| Element `users`, `getUsers()`, `awareness`, `awarenessByStableId` | `everyone`, `getEveryone()` |
| Element `setLive`, `setMyAwareness` | `setMyPresence` |

Old element `users` entries were `{ user, live }`. The entries in `everyone` still answer `person.user` and `person.live`, so old code keeps working.

With `developmentMode`, playhtml logs a one-time notice the first time you use `playhtml.presence`, `room.presence`, or one of the awareness names. `window.cursors` and the `users` / `live` names stay quiet.
