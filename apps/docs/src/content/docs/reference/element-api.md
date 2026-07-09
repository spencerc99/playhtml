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

The initializer has three state buckets: shared **`data`**, per-user **`localData`**, and ephemeral **`awareness`**.

For usage examples, see [Custom elements](/docs/custom-elements/).

## Full shape

### Callback context (`ctx`)

Passed to `updateElement`, `view`, `onClick`, `onDrag`, and `onDragStart`:

```js
{
  data,                // shared synced state (read-only snapshot)
  localData,           // per-user, per-tab; not synced
  awareness,           // array of every user's awareness value for this element
  awarenessByStableId, // Map<stableId, awareness value>
  element,             // the HTMLElement

  setData,             // (next) mutator fn or replacement object
  setLocalData,        // (next) mutator fn or replacement; re-renders view
  setMyAwareness,      // (next) your ephemeral awareness value
  requestUpdate,       // () re-run view now; no-op without view
}
```

`updateElementAwareness` receives the same fields, plus **`myAwareness`** (your own awareness value).

Do not call `setData`, `setLocalData`, or `setMyAwareness` during a `view` render — playhtml logs an error and ignores the write. `setData` merge rules: [Data essentials](/docs/data/data-essentials/).

### `onMount` context

`onMount` uses getters instead of live values (the callback outlives individual renders):

```js
{
  getData,             // () => current shared data
  getLocalData,        // () => current local data
  getAwareness,        // () => awareness array
  getElement,          // () => the HTMLElement

  setData,             // same setters as ctx
  setLocalData,
  setMyAwareness,
  requestUpdate,
}
```

### Initializer

Everything you can set on `can-play` (same object for `register`, `define`, and `extraCapabilities`):

```js
{
  // Starting shared state for elements that render from shared data. Must be
  // an object (or a function that returns one) — not a bare number or string.
  // Synced across the room. Must be paired with updateElement or view.
  defaultData: { count: 0 },
  // defaultData: (element) => ({ color: element.dataset.color }),

  // Per-user, per-tab state. Never synced. Drag anchors, drafts, UI flags.
  defaultLocalData: undefined,

  // Your starting awareness value for this element. Ephemeral — clears on
  // disconnect. Pair with updateElementAwareness.
  myDefaultAwareness: undefined,

  // --- data update path: provide updateElement OR view, not both ---

  updateElement(ctx) {
    // ctx — see Callback context above. Write the DOM from ctx.data.
    // Do not call ctx.setData here — it loops.
  },

  view(ctx) {
    // ctx — see Callback context above. Return a lit-html template.
    // Mutually exclusive with updateElement, onClick, onDrag, onDragStart.
    // Drive ctx.setData from @click handlers, not during render.
  },

  updateElementAwareness(ctx) {
    // ctx — Callback context + myAwareness. Pair with myDefaultAwareness.
  },

  // --- event handlers (ignored when using view) ---

  onClick(e, ctx) {},       // e: MouseEvent; ctx — Callback context
  onDragStart(e, ctx) {},   // e: MouseEvent | TouchEvent, once at drag start
  onDrag(e, ctx) {},         // e: MouseEvent | TouchEvent, each move until release

  onMount(ctx) {
    // ctx — see onMount context above (getters, not live values).
    // May fire before the room's first sync. For presence or page data:
    //   playhtml.ready.then(() => { ... });
    return () => {}; // cleanup on unmount
  },

  // Modifier + click resets to defaultData for everyone. Built-ins use "shiftKey".
  resetShortcut: "shiftKey", // "ctrlKey" | "altKey" | "shiftKey" | "metaKey"

  debounceMs: undefined,    // optional debounce on sync writes; rarely needed

  // For define / extraCapabilities: return false to skip this element.
  isValidElementForTag(element) { return true; },
}
```

---

## `defaultData`

**Required.** Starting shared state for new elements. Must be an **object** (or a function that returns one), not a bare primitive like `0` or `""`.

```js
el.defaultData = { count: 0 };

// Or derive from the element:
el.defaultData = (element) => ({ color: element.dataset.color ?? "yellow" });
```

---

## `defaultLocalData`

Per-user, per-tab state that is **not** synced. Use for drag anchors, hover flags, or UI that only the local client needs.

```js
el.defaultLocalData = { draft: "" };
```

---

## `myDefaultAwareness`

Your starting awareness value for this element. Awareness is ephemeral — it clears when you disconnect. Other clients read it through the `awareness` array in callbacks.

```js
el.myDefaultAwareness = "#2563eb";
```

---

## `updateElement`

Imperative update path. playhtml calls it on mount and whenever shared `data`, `localData`, or awareness changes (locally or from another tab). Write the DOM from `ctx.data`.

Mutually exclusive with `view`. Do not call `setData` inside `updateElement` — that creates a write loop. See [Data essentials](/docs/data/data-essentials/) rule 7.

```js
el.updateElement = ({ element, data }) => {
  element.textContent = String(data.count);
};
```

---

## `view`

**Experimental.** Declarative update path. Return a [lit-html](https://lit.dev/) template; playhtml patches the DOM when state changes.

Mutually exclusive with `updateElement`, `onClick`, `onDrag`, and `onDragStart` — put events in the template (`@click`, etc.).

See [View API](/docs/reference/view-api/) for `register`, `define`, helpers, and handle methods.

---

## `updateElementAwareness`

Called when element awareness changes. Same context as `updateElement`, plus `myAwareness` (your own value).

```js
el.updateElementAwareness = ({ element, awareness }) => {
  element.dataset.viewers = String(awareness.length);
};
```

If the element also has a `view`, awareness changes re-render the view automatically.

---

## `onClick`

Fired on click. Ignored when the element uses `view`.

```js
el.onClick = (_e, { setData }) => {
  setData((d) => { d.count += 1; });
};
```

---

## `onDrag` and `onDragStart`

Drag handlers for mouse and touch. `onDragStart` runs once when the drag begins; `onDrag` runs on each move until release. Ignored when the element uses `view`.

Built-in capabilities like `can-move` and `can-spin` use these internally.

---

## `onMount`

Runs once when the element is wired up. Use for listeners, timers, or `requestAnimationFrame` loops tied to this element.

Return a cleanup function when the element is removed.

**`onMount` vs `playhtml.ready`:** `onMount` fires when this element's handler attaches — that can happen before the room's first sync finishes. `data` may still be `defaultData` until sync lands. Use `onMount` alone for element-scoped setup (listeners, animation loops). Wait on `playhtml.ready` inside `onMount` when you need room-wide state that only exists after sync (presence, `createPageData`, reading final server data):

```js
el.onMount = ({ getData, setData }) => {
  let cancelled = false;

  playhtml.ready.then(() => {
    if (cancelled) return;
    // Safe to read presence, page data, or fully-hydrated shared state here
    const presences = playhtml.presence.getPresences();
    setData((d) => { d.viewerCount = presences.size; });
  });

  return () => { cancelled = true; };
};
```

For a clock-driven `view`, `requestAnimationFrame` in `onMount` is enough — you do not need `playhtml.ready`:

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

---

## `resetShortcut`

When set, a click with that modifier held resets the element to `defaultData` for everyone in the room.

Built-in capabilities use `"shiftKey"`. Custom elements opt in the same way:

```js
el.resetShortcut = "shiftKey";
```

---

## `debounceMs`

Optional debounce window for the handler's internal sync callback. Most custom elements call `setData` from event handlers, which syncs immediately. You rarely need this.

---

## `isValidElementForTag`

Gate which DOM elements a reusable capability (`define` / `extraCapabilities`) applies to. Return `false` to skip an element that carries the attribute but should not bind (for example, when a referenced template is missing).

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

- `defaultData` and `updateElement` / `view` are provided together
- `myDefaultAwareness`, when present, is paired with `updateElementAwareness`
- At least one update function exists: `updateElement`, `view`, or `updateElementAwareness`
- `register` / `define` throw if both `view` and `updateElement` are set, or if `view` is combined with `onClick` / `onDrag` / `onDragStart`

If validation fails, the element is skipped and a console error lists the missing or invalid pair.
