---
title: "Element initializer API"
description: "Configure data defaults, renderers, event handlers, live users, and lifecycle callbacks."
sidebar:
  order: 3
---

The `ElementInitializer` configures a custom collaborative element. Use the same shape in three supported APIs:

1. **`playhtml.register(elementOrId, initializer)`** for one element
2. **`playhtml.define(name, initializer)`** for a reusable capability
3. **`extraCapabilities`** in `playhtml.init()` for capabilities declared during initialization

The initializer has three state buckets: shared **`data`**, per-tab **`localData`**, and ephemeral per-user **`live`** data.

For usage examples, see [Custom elements](/docs/custom-elements/).

Directly assigning initializer fields to an element remains supported for compatibility, but is deprecated for vanilla code. See [Direct element properties](#direct-element-properties-deprecated).

## Full shape

### Callback context (`ctx`)

Passed to `update`, `view`, `onClick`, `onDrag`, and `onDragStart`:

```js
{
  data,                // shared synced state (read-only snapshot)
  localData,           // per-user, per-tab; not synced
  live,                // your ephemeral value for this element
  users,               // [{ user: { pid, name, color, isMe }, live }]
  element,             // the HTMLElement

  setData,             // (next) mutator fn or replacement object
  setLocalData,        // (next) mutator fn or replacement; re-renders view
  setLive,             // (next) your ephemeral value for this element
  requestUpdate,       // () re-run view now; no-op without view
}
```

The deprecated `awareness`, `awarenessByStableId`, `myAwareness`, and `setMyAwareness` fields remain available as compatibility aliases.

Do not call `setData`, `setLocalData`, or `setLive` during a `view` render — playhtml logs an error and ignores the write. `setData` merge rules: [Data essentials](/docs/data/data-essentials/).

### `onMount` context

`onMount` uses getters instead of live values (the callback outlives individual renders):

```js
{
  getData,             // () => current shared data
  getLocalData,        // () => current local data
  getLive,             // () => your current live value
  getUsers,            // () => current element users
  getElement,          // () => the HTMLElement

  setData,             // same setters as ctx
  setLocalData,
  setLive,
  requestUpdate,
}
```

### Initializer

Everything you can put in an initializer for `register`, `define`, or `extraCapabilities`:

```js
{
  // Starting shared state for elements that render from shared data. Must be
  // an object (or a function that returns one) — not a bare number or string.
  // Synced across the room. Must be paired with update or view.
  defaultData: { count: 0 },
  // defaultData: (element) => ({ color: element.dataset.color }),

  // Per-user, per-tab state. Never synced. Drag anchors, drafts, UI flags.
  defaultLocalData: undefined,

  // Your starting live value for this element. Clears when you disconnect.
  live: undefined,

  // --- render path: provide update OR view, not both ---

  update(ctx) {
    // ctx — see Callback context above. Write the DOM from ctx.data and ctx.users.
    // Do not call ctx.setData here — it loops.
  },

  view(ctx) {
    // ctx — see Callback context above. Return a lit-html template.
    // Mutually exclusive with update, onClick, onDrag, onDragStart.
    // Drive ctx.setData from @click handlers, not during render.
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
const initializer = {
  defaultData: { count: 0 },
};

// Or derive from the element:
const derivedInitializer = {
  defaultData: (element) => ({ color: element.dataset.color ?? "yellow" }),
};
```

---

## `defaultLocalData`

Per-user, per-tab state that is **not** synced. Use for drag anchors, hover flags, or UI that only the local client needs.

```js
const initializer = {
  defaultLocalData: { draft: "" },
};
```

---

## `live`

Your starting ephemeral value for this element. It clears when you disconnect. Other clients receive it in `users`, joined with your identity.

```js
const initializer = {
  live: { ready: false },
};
```

---

## `update`

Imperative update path. playhtml calls it on mount and whenever shared `data` or an element user's `live` value changes. Write the DOM from `ctx.data`, `ctx.live`, and `ctx.users`.

Mutually exclusive with `view`. Do not call `setData` inside `update` — that creates a write loop. See [Data essentials](/docs/data/data-essentials/) rule 7.

```js
const initializer = {
  update: ({ element, data, users }) => {
    element.textContent = String(data.count);
    element.dataset.users = String(users.length);
  },
};
```

---

## `view`

**Experimental.** Declarative update path. Return a [lit-html](https://lit.dev/) template; playhtml patches the DOM when state changes.

Mutually exclusive with `update`, `onClick`, `onDrag`, and `onDragStart` — put events in the template (`@click`, etc.).

See [Registration API](/docs/reference/view-api/) for `register`, `define`, helpers, and handle methods.

---

## Deprecated compatibility names

`updateElement`, `myDefaultAwareness`, `updateElementAwareness`, `awareness`, `awarenessByStableId`, `myAwareness`, `setMyAwareness`, and `getAwareness` remain available for existing elements. New code should use `update`, `live`, `users`, `setLive`, `getLive`, and `getUsers`. Supplying both names from an alias pair, such as `update` and `updateElement`, is an error.

---

## `onClick`

Fired on click. Ignored when the element uses `view`.

```js
const initializer = {
  onClick: (_event, { setData }) => {
    setData((data) => {
      data.count += 1;
    });
  },
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
const initializer = {
  onMount: ({ getData, setData }) => {
    let cancelled = false;

    playhtml.ready.then(() => {
      if (cancelled) return;
      const presences = playhtml.presence.getPresences();
      setData((data) => {
        data.viewerCount = presences.size;
      });
    });

    return () => {
      cancelled = true;
    };
  },
};
```

For a clock-driven `view`, `requestAnimationFrame` in `onMount` is enough — you do not need `playhtml.ready`:

```js
const initializer = {
  onMount: ({ getData, requestUpdate }) => {
    let raf;
    const tick = () => {
      if (getData().running) requestUpdate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  },
};
```

---

## `resetShortcut`

When set, a click with that modifier held resets the element to `defaultData` for everyone in the room.

Built-in capabilities use `"shiftKey"`. Custom elements opt in the same way:

```js
const initializer = {
  resetShortcut: "shiftKey",
};
```

---

## `debounceMs`

Optional debounce window for the handler's internal sync callback. Most custom elements call `setData` from event handlers, which syncs immediately. You rarely need this.

---

## `isValidElementForTag`

Gate which DOM elements a reusable capability (`define` / `extraCapabilities`) applies to. Return `false` to skip an element that carries the attribute but should not bind (for example, when a referenced template is missing).

---

## Registering an initializer

Pass the initializer to `playhtml.register`. The element needs a stable, unique `id`; the `can-play` attribute is optional because `register` supplies the custom capability.

```html
<div id="counter"></div>

<script type="module">
  import { playhtml } from "playhtml";

  playhtml.register("counter", {
    defaultData: { count: 0 },
    onClick: (_event, { setData }) => {
      setData((data) => {
        data.count += 1;
      });
    },
    update: ({ element, data }) => {
      element.textContent = String(data.count);
    },
  });

  playhtml.init();
</script>
```

`register` can run before or after `playhtml.init()`, and before or after the element exists. It binds when both the registration and element are available.

When the same element also has a built-in capability such as `can-move`, each capability keeps its own data and behavior.

## Direct element properties (deprecated)

Direct assignments such as `element.defaultData = …` and `element.updateElement = …` remain supported so existing sites and React integrations keep working. Do not use them in new vanilla code. Move every initializer field into the object passed to `register`.

The compatibility path reads these keys from the element: `defaultData`, `defaultLocalData`, `myDefaultAwareness`, `updateElement`, `view`, `updateElementAwareness`, `onClick`, `onDrag`, `onDragStart`, `onMount`, `resetShortcut`, `debounceMs`, and `isValidElementForTag`.

If existing code assigns those properties and calls `setupPlayElement(element)`, replace both steps with `register(element, initializer)`. `setupPlayElement` remains supported for dynamically added built-in and defined capabilities.

---

## Validation

At registration time, playhtml checks:

- `defaultData` and `update` / `view` are provided together
- `live`, when present, is paired with `update` / `view`
- At least one renderer exists: `update` or `view`
- `register` / `define` throw if both `view` and `update` are set, if both `update` and `updateElement` are set, or if `view` is combined with `onClick` / `onDrag` / `onDragStart`

If validation fails, the element is skipped and a console error lists the missing or invalid pair.
