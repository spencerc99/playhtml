---
title: "Element API (can-play)"
description: "Every property of the ElementInitializer: data defaults, updateElement, view, event handlers, awareness, lifecycle, and callback contexts."
sidebar:
  order: 3
---

The `ElementInitializer` is the config object for a custom collaborative element. Use the same shape in three places:

1. **DOM properties** on a `can-play` element, set before `playhtml.init()`
2. **`playhtml.register(id, init)`** / **`playhtml.define(name, init)`** — see [View API](/docs/reference/view-api/)
3. **`extraCapabilities`** in `playhtml.init()` — see [init options](/docs/reference/init-options/#extracapabilities)

The three type parameters are **`T`** (shared `data`), **`U`** (`localData`), and **`V`** (awareness value).

For usage examples, see [Custom elements](/docs/custom-elements/).

```ts
interface ElementInitializer<T = any, U = any, V = any> {
  defaultData: T | ((element: HTMLElement) => T);
  defaultLocalData?: U | ((element: HTMLElement) => U);
  myDefaultAwareness?: V | ((element: HTMLElement) => V);

  view?: (ctx: ElementEventHandlerData<T, U, V>) => unknown;
  updateElement?: (ctx: ElementEventHandlerData<T, U, V>) => void;
  updateElementAwareness?: (ctx: ElementAwarenessEventHandlerData<T, U, V>) => void;

  onClick?: (e: MouseEvent, ctx: ElementEventHandlerData<T, U, V>) => void;
  onDrag?: (e: MouseEvent | TouchEvent, ctx: ElementEventHandlerData<T, U, V>) => void;
  onDragStart?: (e: MouseEvent | TouchEvent, ctx: ElementEventHandlerData<T, U, V>) => void;
  onMount?: (ctx: ElementSetupData<T, U, V>) => void | (() => void);

  resetShortcut?: ModifierKey;
  debounceMs?: number;
  isValidElementForTag?: (element: HTMLElement) => boolean;
}

type ModifierKey = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";
```

---

## `defaultData`

**Type:** `T | ((element: HTMLElement) => T)`  
**Required:** yes

Starting shared state for new elements. Must be an **object** (or a function that returns one), not a bare primitive like `0` or `""`. An object shape lets you add fields later without breaking rooms that already have data.

```js
el.defaultData = { count: 0 };

// Or derive from the element:
el.defaultData = (element) => ({ color: element.dataset.color ?? "yellow" });
```

---

## `defaultLocalData`

**Type:** `U | ((element: HTMLElement) => U)`  
**Default:** `undefined`

Per-user, per-tab state that is **not** synced. Use for drag anchors, hover flags, or UI that only the local client needs.

```js
el.defaultLocalData = { draft: "" };
```

---

## `myDefaultAwareness`

**Type:** `V | ((element: HTMLElement) => V)`  
**Default:** `undefined`

Your starting awareness value for this element. Awareness is ephemeral — it clears when you disconnect. Other clients read it through the `awareness` array in callbacks.

```js
el.myDefaultAwareness = "#2563eb";
```

---

## `updateElement`

**Type:** `(ctx: ElementEventHandlerData) => void`  
**Default:** `undefined`

Imperative update path. playhtml calls it on mount and whenever shared `data`, `localData`, or awareness changes (locally or from another tab). Write the DOM from `ctx.data`.

Mutually exclusive with `view`. Do not call `setData` inside `updateElement` — that creates a write loop. See [Data essentials](/docs/data/data-essentials/) rule 7.

```js
el.updateElement = ({ element, data }) => {
  element.textContent = String(data.count);
};
```

---

## `view`

**Type:** `(ctx: ElementEventHandlerData) => TemplateResult`  
**Default:** `undefined`  
**Status:** experimental

Declarative update path. Return a [lit-html](https://lit.dev/) template; playhtml patches the DOM when state changes.

Mutually exclusive with `updateElement`, `onClick`, `onDrag`, and `onDragStart` — put events in the template (`@click`, etc.).

See [View API](/docs/reference/view-api/) for `register`, `define`, helpers, and handle methods.

---

## `updateElementAwareness`

**Type:** `(ctx: ElementAwarenessEventHandlerData) => void`  
**Default:** `undefined`

Called when element awareness changes. Same context as `updateElement`, plus `myAwareness` (your own value).

```js
el.updateElementAwareness = ({ element, awareness }) => {
  element.dataset.viewers = String(awareness.length);
};
```

If the element also has a `view`, awareness changes re-render the view automatically.

---

## `onClick`

**Type:** `(e: MouseEvent, ctx: ElementEventHandlerData) => void`  
**Default:** `undefined`

Fired on click. Ignored when the element uses `view`.

```js
el.onClick = (_e, { setData }) => {
  setData((d) => { d.count += 1; });
};
```

---

## `onDrag` and `onDragStart`

**Type:** `(e: MouseEvent | TouchEvent, ctx: ElementEventHandlerData) => void`  
**Default:** `undefined`

Drag handlers for mouse and touch. `onDragStart` runs once when the drag begins; `onDrag` runs on each move until release. Ignored when the element uses `view`.

Built-in capabilities like `can-move` and `can-spin` use these internally.

---

## `onMount`

**Type:** `(ctx: ElementSetupData) => void | (() => void)`  
**Default:** `undefined`

Runs once when the element is wired up. Use for extra listeners, timers, or `requestAnimationFrame` loops.

Return a cleanup function to cancel listeners or loops when the element is removed.

```js
el.onMount = ({ getData, requestUpdate }) => {
  let raf;
  const tick = () => {
    if (getData().running) requestUpdate();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
};
```

`additionalSetup` is a deprecated alias for `onMount`.

---

## `resetShortcut`

**Type:** `ModifierKey`  
**Default:** `undefined`

When set, a click with that modifier held resets the element to `defaultData` for everyone in the room.

Built-in capabilities use `"shiftKey"`. Custom elements opt in the same way:

```js
el.resetShortcut = "shiftKey";
```

---

## `debounceMs`

**Type:** `number`  
**Default:** `undefined`

Optional debounce window for the handler's internal sync callback. Most custom elements call `setData` from event handlers, which syncs immediately. You rarely need this.

---

## `isValidElementForTag`

**Type:** `(element: HTMLElement) => boolean`  
**Default:** `undefined`

Gate which DOM elements a reusable capability (`define` / `extraCapabilities`) applies to. Return `false` to skip an element that carries the attribute but should not bind (for example, when a referenced template is missing).

---

## Event-handler context

Passed to `updateElement`, `view`, `onClick`, `onDrag`, and `onDragStart`:

```ts
interface ElementEventHandlerData<T, U, V> {
  data: T;
  localData: U;
  awareness: V[];
  awarenessByStableId: Map<string, V>;
  element: HTMLElement;

  setData(next: T | ((draft: T) => void)): void;
  setLocalData(next: U | ((draft: U) => void)): void;
  setMyAwareness(next: V): void;
  requestUpdate(): void;
}
```

| Field | Notes |
| --- | --- |
| `data` | Shared, synced state (read-only snapshot in callbacks). |
| `localData` | Per-user, not synced. |
| `awareness` | Every connected user's awareness value for this element. |
| `awarenessByStableId` | Same values keyed by stable player id. |
| `setData` | Mutator form `setData(d => { … })` is merge-friendly and preferred for lists and nested fields. Value form `setData({ … })` replaces the whole snapshot (last-write-wins). See [Data essentials](/docs/data/data-essentials/). |
| `setLocalData` | Updates local state. Re-renders `view` elements; does not re-run `updateElement`. |
| `setMyAwareness` | Broadcasts your awareness value. Does not persist. |
| `requestUpdate` | Re-runs `view` now. No-op without a `view`. Use for clock-driven UI. |

Do not call `setData`, `setLocalData`, or `setMyAwareness` during a `view` render — playhtml logs an error and ignores the write.

---

## Awareness context

Same as the event-handler context, plus:

```ts
interface ElementAwarenessEventHandlerData<T, U, V>
  extends ElementEventHandlerData<T, U, V> {
  myAwareness?: V;
}
```

Used by `updateElementAwareness`.

---

## Setup context (`onMount`)

Same write methods as above, but reads use getters because `onMount` outlives individual renders:

```ts
interface ElementSetupData<T, U, V> {
  getData(): T;
  getLocalData(): U;
  getAwareness(): V[];
  getElement(): HTMLElement;

  setData(next: T | ((draft: T) => void)): void;
  setLocalData(next: U | ((draft: U) => void)): void;
  setMyAwareness(next: V): void;
  requestUpdate(): void;
}
```

---

## Setting properties on the DOM element

For `can-play`, set initializer properties on the element before `playhtml.init()`:

```html
<div id="counter" can-play></div>

<script type="module">
  import { playhtml } from "playhtml";

  const el = document.getElementById("counter");
  el.defaultData = { count: 0 };
  el.onClick = (_e, { setData }) => setData((d) => { d.count += 1; });
  el.updateElement = ({ element, data }) => {
    element.textContent = String(data.count);
  };

  playhtml.init();
</script>
```

playhtml reads these keys off the element: `defaultData`, `defaultLocalData`, `myDefaultAwareness`, `updateElement`, `view`, `updateElementAwareness`, `onClick`, `onDrag`, `onDragStart`, `onMount`, `resetShortcut`, `debounceMs`, `isValidElementForTag`.

When an element has both `can-play` and a built-in capability (e.g. `can-move`), built-in tags keep their own initializer; `can-play` properties apply only to the custom slot.

---

## Validation

At registration time, playhtml checks:

- `defaultData` is present and is an object or a function
- At least one update path exists: `updateElement` **or** `view`
- `register` / `define` throw if both `view` and `updateElement` are set, or if `view` is combined with `onClick` / `onDrag` / `onDragStart`

If validation fails, the element is skipped and a console warning lists the missing fields.
