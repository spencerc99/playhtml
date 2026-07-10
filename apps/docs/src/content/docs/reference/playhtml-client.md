---
title: "playhtml client"
description: "Every method and property on the playhtml object: init, configure, element setup and teardown, events, page data, presence, and lifecycle."
sidebar:
  order: 4
---

The `playhtml` object is the library entry point. Import it from the package, or use `window.playhtml` after a script tag loads.

```js
// ES module
import { playhtml } from "playhtml";

// Script tag (CDN) — available as window.playhtml after the script loads
// <script type="module" src="https://unpkg.com/playhtml/dist/index.js"></script>
playhtml.init();
```

**API groups at a glance:**

| Group | Members |
|---|---|
| Lifecycle | `init`, `configure`, `ready`, `isLoading`, `handleNavigation` |
| Element setup & teardown | `setupPlayElements`, `setupPlayElement`, `setupPlayElementForTag`, `removePlayElement`, `deleteElementData` |
| Custom elements _(experimental)_ | `register`, `define`, `getHandle` |
| Events | `dispatchPlayEvent`, `registerPlayEventListener`, `removePlayEventListener` |
| Page data | `createPageData` |
| Presence | `presence`, `createPresenceRoom`, `cursorClient` |
| Inspection | `roomId`, `host`, `syncedStore`, `elementHandlers`, `eventHandlers`, `listSharedElements` |

---

## Lifecycle

### `init(options?)`

**Signature:** `init(options?: InitOptions): Promise<void>`

Connects to the room and activates playhtml elements. Resolves when initial sync finishes (same as `await playhtml.ready`).

```js
import { playhtml } from "playhtml";

await playhtml.init({ room: "my-room" });
```

Safe to call more than once. Later calls reuse the connection. Options must match the first call; conflicting options warn and are ignored.

See [init() options](/docs/reference/init-options/) for all options.

---

### `configure(options?)`

**Signature:** `configure(options?: InitOptions): void`

Records options without connecting. Use when you cannot call a single `init()` at the top of the app (islands, multi-page sites, multiple roots).

```js
// In a script that runs early (e.g. in <head>):
playhtml.configure({ cursors: { enabled: true } });

// Anywhere later — these just ensure playhtml is running:
playhtml.init();
```

`configure()` only records options; connection does not start until `init()` is called. If `init()` has already started, `configure()` behaves like a late `init()` call: matching options are accepted, conflicting options warn.

See [init() options](/docs/reference/init-options/) for all available options.

---

### `ready`

**Type:** `Promise<void>` _(read-only)_

Resolves when the initial sync is complete and elements are active. Rejects if the connection fails.

```js
playhtml.init();

// Await sync before reading shared state
await playhtml.ready;
console.log("synced:", playhtml.roomId);
```

---

### `isLoading`

**Type:** `boolean` _(read-only)_

`true` from the time `init()` is called until the initial sync completes; `false` thereafter. Useful for showing a loading indicator.

```js
if (playhtml.isLoading) {
  document.body.classList.add("loading");
}
playhtml.ready.then(() => {
  document.body.classList.remove("loading");
});
```

---

### `handleNavigation()`

**Signature:** `handleNavigation(): Promise<void>`

Re-derives the room from the URL (or your `room` function), tears down the old room, and re-scans the DOM. Call after client-side navigation.

```js
router.on("navigate", () => playhtml.handleNavigation());
```

See [Navigation & SPAs](/docs/advanced/navigation/) for a full guide and framework-specific examples.

---

## Element setup & teardown

### `setupPlayElement(element, options?)`

**Signature:** `setupPlayElement(element: Element, options?: { ignoreIfAlreadySetup?: boolean }): void`

Registers one element after `init()`. Use for elements added dynamically.

Pass `{ ignoreIfAlreadySetup: true }` to skip elements that are already registered.

The element needs a unique `id`.

```js
const card = document.createElement("div");
card.id = "card-1";
card.setAttribute("can-move", "");
document.body.appendChild(card);
playhtml.setupPlayElement(card);
```

---

### `setupPlayElements()`

**Signature:** `setupPlayElements(): void`

Scans the entire document and registers every element that carries a playhtml capability attribute. Called internally at the end of `init()`. Useful if you inject a batch of playhtml elements into the DOM at once and want to activate them all in one pass.

```js
container.innerHTML = serverRenderedHtml;
playhtml.setupPlayElements();
```

---

### `setupPlayElementForTag(element, tag)`

**Signature:** `setupPlayElementForTag(element: HTMLElement, tag: string): Promise<void>`

Registers an element for a single specific capability tag. Lower-level than `setupPlayElement`; only needed when you want to activate one capability on an element that may carry others you do not want to activate yet.

```js
await playhtml.setupPlayElementForTag(el, "can-move");
```

---

### `removePlayElement(element)`

**Signature:** `removePlayElement(element: Element | null): void`

Detaches the element's handler (listeners, timers, observers) but **keeps shared data**. Use when the DOM node is removed but may come back.

To delete shared data too, use [`deleteElementData`](#deleteelementdata).

```js
playhtml.removePlayElement(document.getElementById("card-1"));
```

---

### `deleteElementData(tag, elementId)`

**Signature:** `deleteElementData(tag: string, elementId: string): void`

Deletes shared data for `tag` + `elementId`. Propagates to all clients. Also removes the local handler.

```js
playhtml.deleteElementData("can-duplicate", "clone-abc123");
```

:::caution
Permanent for all clients once synced. To hide an element but keep data, use `removePlayElement`.
:::

Throws a console warning if called before `init()` completes sync.

---

## Custom elements (experimental)

:::caution[Experimental]
`register`, `define`, and `getHandle` are part of the new view API and are **experimental** — signatures may change in a future minor release. The imperative `can-play` path (`updateElement`) is unaffected. Feedback welcome on [#95](https://github.com/spencerc99/playhtml/issues/95).
:::

These three methods are part of the experimental view API. See [View API](/docs/reference/view-api/).

### `register(elementId, init)`

**Signature:** `register<T, U, V>(elementId: string, init: ElementInitializer<T, U, V>): PlayElementHandle<T, U, V>`

Binds an initializer to one element by id. Returns a handle for reads and writes from outside the element's own callbacks. Callable before or after `init()` and before or after the element exists in the DOM.

```js
const handle = playhtml.register("my-counter", {
  defaultData: { count: 0 },
  view: ({ data, setData }) => html`
    <button @click=${() => setData(d => { d.count++ })}>
      Clicked ${data.count} times
    </button>
  `,
});
```

---

### `define(capabilityName, init)`

**Signature:** `define<T, U, V>(capabilityName: string, init: ElementInitializer<T, U, V>): void`

Registers a reusable capability under an attribute name. Every element carrying `[capabilityName]` binds, including elements added to the DOM later. The runtime equivalent of `init({ extraCapabilities })`.

```js
playhtml.define("can-note", {
  defaultData: { text: "" },
  view: ({ data, setData }) => html`
    <textarea @input=${(e) => setData({ text: e.target.value })}>${data.text}</textarea>
  `,
});
```

Throws if `capabilityName` collides with a built-in capability name.

---

### `getHandle(elementId, capability?)`

**Signature:** `getHandle(elementId: string, capability?: string): PlayElementHandle`

Returns a handle for any bound element. When one element carries multiple capabilities, pass the capability name (e.g. `"can-toggle"`) to disambiguate.

```js
const handle = playhtml.getHandle("card-1", "can-move");
console.log(handle.getData()); // { x: 120, y: 45 }
```

---

## Events

Events let you broadcast custom actions across all connected clients in the room. See [Events](/docs/data/events/) for the full guide.

### `registerPlayEventListener(type, event)`

**Signature:** `registerPlayEventListener(type: string, event: Omit<PlayEvent, "type">): string`

Registers a listener for a custom event type. Returns a unique string `id` that you can pass to `removePlayEventListener` to clean up later.

```ts
// PlayEvent shape:
interface PlayEvent<T = any> {
  type: string;
  onEvent: (eventPayload: { eventPayload: T }) => void;
}
```

```js
const listenerId = playhtml.registerPlayEventListener("confetti", {
  onEvent: () => window.confetti({ particleCount: 100 }),
});
```

Multiple listeners for the same `type` are allowed — each gets its own `id`.

---

### `dispatchPlayEvent(message)`

**Signature:** `dispatchPlayEvent(message: EventMessage): void`

Broadcasts an event to all connected clients, including the sender. The `type` must already be registered via `registerPlayEventListener` (or the `events` init option).

```ts
// EventMessage shape:
type EventMessage<T = any> = { type: string; eventPayload?: T };
```

```js
playhtml.dispatchPlayEvent({ type: "confetti" });
// With a payload:
playhtml.dispatchPlayEvent({ type: "highlight", eventPayload: { elementId: "card-1" } });
```

---

### `removePlayEventListener(type, id)`

**Signature:** `removePlayEventListener(type: string, id: string): void`

Removes the listener identified by `type` and the `id` returned from `registerPlayEventListener`.

```js
playhtml.removePlayEventListener("confetti", listenerId);
```

---

## Page data

Page data lets you read and write named shared values that are not tied to any DOM element — good for page-wide settings, counters, or leaderboards.

See [Page data](/docs/data/page-data/) for a full guide.

### `createPageData(name, defaultValue)`

**Signature:** `createPageData<T>(name: string, defaultValue: T): PageDataChannel<T>`

Creates (or re-opens) a named shared data channel in the current room. Must be called after `playhtml.ready` resolves.

```js
await playhtml.ready;

const views = playhtml.createPageData("viewCount", 0);
views.setData((n) => n + 1);
views.onUpdate((n) => {
  document.getElementById("views").textContent = String(n);
});
```

**`PageDataChannel<T>` methods:**

| Method | Description |
|---|---|
| `getData(): T` | Returns the current value. |
| `setData(data: T \| ((draft: T) => void)): void` | Updates the value. Pass a mutator function for nested objects. |
| `onUpdate(callback: (data: T) => void): () => void` | Subscribes to changes. Returns an unsubscribe function. |
| `destroy(): void` | Tears down the channel and removes all subscriptions. |

Throws if called before `init()` completes sync.

---

## Presence

Presence tracks who is in the room and what they are doing. See [Presence & identity](/docs/reference/presence/) for types and API details. Usage guide: [Presence](/docs/data/presence/).

### `users`

**Type:** `{ me, getAll(), onChange(cb) }`

Durable user identity — name, color, and custom properties — for everyone in the room, whether or not cursors are enabled. Throws if accessed before `init()` completes. Usage guide: [Users](/docs/data/presence/users/).

```js
await playhtml.ready;

playhtml.users.me.name = "Alice";
playhtml.users.me.setCustom("status", "away", { persist: false });

const everyone = playhtml.users.getAll(); // Map<pid, { pid, name, color, custom, isMe }>
const unsubscribe = playhtml.users.onChange((users) => {
  console.log(`${users.size} people here`);
});
```

---

### `presence`

**Type:** `PresenceAPI`

The main presence object for the current room. Throws if accessed before `init()` completes.

```js
await playhtml.ready;

const presences = playhtml.presence.getPresences();
console.log(`${presences.size} people in this room`);
```

**`PresenceAPI` methods:**

| Method | Description |
|---|---|
| `setMyPresence(channel: string, data: unknown): void` | Broadcasts a presence value on the given channel to other clients. |
| `getPresences(): Map<string, PresenceView>` | Returns a snapshot map of all currently visible presences, keyed by connection id. Each entry includes `cursor`, `isMe`, and `playerIdentity` alongside any data you set. |
| `onPresenceChange(channel: string, callback: (presences: Map<string, PresenceView>) => void): () => void` | Subscribes to presence changes on the given channel. Returns an unsubscribe function. |
| `getMyIdentity(): PlayerIdentity` | Returns the local player's persistent identity object. |

---

### `createPresenceRoom(name)`

**Signature:** `createPresenceRoom(name: string): PresenceRoom`

Creates a separate presence scope (sidebar, nested panel). Call `destroy()` when done.

```js
await playhtml.ready;

const sidebar = playhtml.createPresenceRoom("sidebar");
sidebar.presence.setMyPresence("focus", { section: "comments" });

// Tear down when done
sidebar.destroy();
```

**`PresenceRoom` shape:**

```ts
interface PresenceRoom {
  presence: PresenceAPI;
  destroy(): void;
}
```

Throws if called before `init()` completes sync.

---

### `cursorClient`

**Type:** `CursorClientAwareness | null`

Low-level cursor client, or `null` if cursors are disabled. Most config belongs in `init({ cursors: … })`. See [Cursors](/docs/data/presence/cursors/).

---

## Inspection

Read-only debug surfaces. Do not mutate them directly.

### `roomId`

**Type:** `string` _(read-only)_

The normalised room id the client is currently connected to (hostname-prefixed). Empty string before `init()`.

```js
console.log(playhtml.roomId); // e.g. "example.com-/my-page"
```

---

### `host`

**Type:** `string` _(read-only)_

The PartyKit host the client is currently connected to. Useful for debugging custom host configurations.

---

### `listSharedElements()`

**Signature:**
```ts
listSharedElements(): Array<{
  type: "source" | "consumer";
  elementId: string;
  dataSource: string;
  normalized: string;
  permissions?: "read-only" | "read-write";
  element: HTMLElement;
}>
```

Returns a list of every shared-element source and consumer currently registered in the page. Useful for debugging `shared` / `data-source` wiring.

See [Shared elements](/docs/advanced/shared-elements/) for the full guide.

---

### `syncedStore`

**Type:** `ReadOnlyStore<PlayStore["play"]>` _(read-only)_

A read-only view into the underlying synced data store, keyed by capability tag then element id. Useful for inspecting the raw shared state of all elements in the devtools console. Do not write to this object — mutations will not be validated or synced correctly. Use `setData` from an element handler instead.

---

### `elementHandlers`

**Type:** `Map<string, Map<string, ElementHandler>>`

A nested map of all active element handlers, keyed first by capability tag, then by element id. Useful in devtools for inspecting which elements are registered and accessing their current data.

---

### `eventHandlers`

**Type:** `Map<string, Array<RegisteredPlayEvent>>`

A map of all registered event listeners, keyed by event type. Useful for verifying that event listeners were registered correctly and checking for duplicates.
