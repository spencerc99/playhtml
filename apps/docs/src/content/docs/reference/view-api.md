---
title: "View API (vanilla)"
description: "playhtml.register, playhtml.define, the view function, the element handle, and lit-html helpers."
sidebar:
  order: 6
---

The vanilla API for building custom collaborative elements. For usage with side-by-side examples, see [Custom elements](/docs/custom-elements/); for the React equivalent, see the [React API](/docs/reference/react-api/).

:::caution[Experimental]
This API (`register` / `define` / `view`) is new and **experimental** — signatures may change in a future minor release. The imperative `can-play` path (`updateElement`) is unaffected. Feedback welcome on [#95](https://github.com/spencerc99/playhtml/issues/95).
:::

```js
import { playhtml, html, svg, repeat, classMap, styleMap, nothing } from "playhtml";
```

## `playhtml.register(elementId, init)`

Binds an initializer to one element by `id` and returns a [handle](#playelementhandle). Callable before or after `playhtml.init()` and before or after the element exists in the DOM — binding happens once both are present (like `customElements.define`).

```js
const handle = playhtml.register("my-counter", init);
```

- The element needs a stable, unique `id` (it _is_ the `elementId`). The `can-play` attribute is optional — `register` implies it.
- Re-registering the same id replaces its initializer.

## `playhtml.define(capabilityName, init)`

Registers a reusable capability under an attribute name. Every element carrying `[capabilityName]` binds — including ones added later, or rendered by a [view](#composition). The imperative counterpart of `init({ extraCapabilities })`.

```js
playhtml.define("can-note", init);
```

Defining a name that collides with a built-in capability throws. Each bound element still needs a unique `id`.

## `playhtml.getHandle(elementId, capability?)`

Returns a [handle](#playelementhandle) for any bound element. Because data is keyed by capability **and** id, pass the capability name when one element carries more than one.

```js
const handle = playhtml.getHandle("card-1", "can-move");
```

## The `init` object

The full annotated property list is on [Element API](/docs/reference/element-api/#initializer). The `view` argument is **`ctx`** — see [Callback context](/docs/reference/element-api/#callback-context-ctx).

`defaultData` must be an object (or a function that returns one), not a bare value like `0` or `""`. Use `{ count: 0 }`, not `0`.

A valid initializer provides exactly one update path — `view` **or** `updateElement`.

## The view context

`view` receives **`ctx`** ([Callback context](/docs/reference/element-api/#callback-context-ctx)). Drive `ctx.setData` from `@click` handlers, not during render.

`onMount` gets getters (`getData()`, `getElement()`, …) instead of live values. See [Element API → onMount](/docs/reference/element-api/#onmount) for the `playhtml.ready` pattern.

## `PlayElementHandle`

Returned by `register` and `getHandle`. Reads and writes resolve the live handler lazily — a handle obtained before binding works once the element exists.

```js
{
  id,
  getElement(),      // null until bound
  getData(),         // undefined until bound
  setData(next),
  setLocalData(next),
  setMyAwareness(next),
  requestUpdate(),   // no-op without a view
  unregister(),      // detach + run onMount cleanup; shared data is kept
}
```

A write through a handle whose element hasn't bound yet is dropped (with a dev-mode warning); reads return `undefined`.

## Re-exported lit-html helpers

`playhtml` re-exports the lit-html pieces a `view` needs. `unsafeHTML` is intentionally **not** exported, so interpolated values stay auto-escaped.

| Export | Use |
| --- | --- |
| `html` | the tagged template for view output |
| `svg` | SVG fragments (e.g. `<path>` inside `<svg>`) |
| `repeat(items, keyFn, template)` | keyed lists — key by a stable unique id |
| `classMap(obj)` | conditional classes |
| `styleMap(obj)` | conditional inline styles (safer than a `style` string) |
| `nothing` | render nothing (or just return `null` / `undefined`) |

See the [lit-html templating guide](https://lit.dev/docs/templates/overview/) for the full template syntax.
