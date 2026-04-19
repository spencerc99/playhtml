---
title: "playhtml.init() options"
description: "Every option accepted by playhtml.init() / PlayProvider initOptions."
sidebar:
  order: 1
---

Every option below can be passed either to `playhtml.init({…})` (vanilla) or to `<PlayProvider initOptions={{…}}>` (React). The underlying `InitOptions` interface is the same.

```js
import { playhtml } from "playhtml";

playhtml.init({
  room: "my-room",
  cursors: { enabled: true },
  // …
});
```

## `room`

**Type:** `string` &nbsp; **Default:** `window.location.pathname + window.location.search`

The room to connect users to — users sharing a room share state. Every room is automatically prefixed with `window.location.hostname` so your rooms can never collide with another site's rooms.

If you leave this blank, playhtml derives the room from the URL. Two readers on `/docs/capabilities` share state; a reader on `/docs/concepts` is in a different room.

Override it when you want to decouple state from the URL — for example, a site-wide guestbook that should behave the same no matter which page it's embedded on:

```js
playhtml.init({ room: "global-guestbook" });
```

## `host`

**Type:** `string` &nbsp; **Default:** the public playhtml PartyKit host

Pass your own PartyKit host if you want to self-host the syncing server for extra control, custom server-side logic, or data-residency requirements.

```js
playhtml.init({
  host: "mypartykit.user.partykit.dev",
});
```

You're responsible for deploying a compatible PartyKit worker — see the [playhtml repo](https://github.com/spencerc99/playhtml) for the current worker implementation.

## `events`

**Type:** `Record<string, PlayEvent>` &nbsp; **Default:** `undefined`

Declare event listeners inline at init time. Handy for events that should always be wired up.

```js
playhtml.init({
  events: {
    confetti: {
      type: "confetti",
      onEvent: () => window.confetti({ particleCount: 100 }),
    },
  },
});
```

You can also register events imperatively later with `playhtml.registerPlayEventListener`. See [Events](/docs/data/events/).

## `extraCapabilities`

**Type:** `Record<string, ElementInitializer>` &nbsp; **Default:** `undefined`

Ship your own `can-*` capability alongside the built-ins. Most authors never need this — use `can-play` on individual elements first. Reach for `extraCapabilities` when you're packaging a capability you want to reuse across many elements and want the shorter `can-mything` attribute form.

```js
playhtml.init({
  extraCapabilities: {
    "can-pulse": {
      defaultData: { on: false },
      updateElement: ({ element, data }) => {
        element.classList.toggle("pulsing", data.on);
      },
      onClick: (_e, { data, setData }) => setData({ on: !data.on }),
    },
  },
});
```

## `defaultRoomOptions`

**Type:** `DefaultRoomOptions` &nbsp; **Default:** `undefined`

Configuration for the auto-derived URL-based room. Most apps don't need to touch this.

## `onError`

**Type:** `() => void` &nbsp; **Default:** `undefined`

Callback for connection failures. Handy for showing an error UI or logging to your own monitoring system.

```js
playhtml.init({
  onError: () => {
    document.body.classList.add("playhtml-offline");
    console.warn("playhtml could not connect");
  },
});
```

## `developmentMode`

**Type:** `boolean` &nbsp; **Default:** `false`

Enable the in-page devtools panel. Shows element inspector, live data tree, connection status, and tag-type badges — modeled after RollerCoaster Tycoon's inspect UI. Useful while debugging.

```js
playhtml.init({ developmentMode: true });
```

:::note
Turn this on in development builds, not production. A dedicated guide covering the devtools is planned.
:::

## `cursors`

**Type:** `CursorOptions` &nbsp; **Default:** `undefined` (cursors disabled)

Opt into multiplayer cursors, presence identity, chat, and proximity detection. The full set of cursor options is documented on the [Cursors](/docs/data/presence/cursors/) page; this is the top-level shape:

```ts
interface CursorOptions {
  enabled: boolean;
  room?: "page" | "domain" | "section" | ((ctx) => string);
  shouldRenderCursor?: (presence) => boolean;
  getCursorStyle?: (presence) => Partial<CSSStyleDeclaration>;
  playerIdentity?: PlayerIdentity;
  proximityThreshold?: number;
  onProximityEntered?: (identity, positions, angle) => void;
  onProximityLeft?: (connectionId) => void;
  visibilityThreshold?: number;
  enableChat?: boolean;
  onCustomCursorRender?: (connectionId, element) => Element | null;
}
```

Minimal opt-in:

```js
playhtml.init({ cursors: { enabled: true } });
```

Domain-wide presence with page-specific cursors (common pattern):

```js
playhtml.init({
  cursors: {
    enabled: true,
    room: "domain",
    shouldRenderCursor: (p) => p.page === window.location.pathname,
  },
});
```

See [Cursors](/docs/data/presence/cursors/) for the full config reference and recipes.

## React equivalent

Every option on this page is passed through `initOptions` on `<PlayProvider>`.

```tsx
import { PlayProvider } from "@playhtml/react";

<PlayProvider
  initOptions={{
    room: "my-room",
    cursors: { enabled: true },
    developmentMode: true,
  }}
>
  {/* your app */}
</PlayProvider>;
```

No React-specific options on the provider itself — all config flows through the shared `InitOptions` shape.
