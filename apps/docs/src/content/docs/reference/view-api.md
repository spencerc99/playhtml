---
title: "Registration API (vanilla)"
description: "Register one-off elements and reusable capabilities with initializer objects."
sidebar:
  order: 6
---

Register a custom collaborative element with one initializer object. Use `register` for one element and `define` for a reusable capability.

:::caution[Experimental]
The declarative `view` renderer and the lit-html helpers are experimental. `register`, `define`, handles, and the imperative `update` renderer are supported APIs.
:::

```js
import { playhtml, html, svg, repeat, classMap, styleMap, nothing } from "playhtml";
```

## `playhtml.register(elementOrId, init)`

Binds an initializer to one element and returns a [handle](#playelementhandle). Pass an element when you already have the DOM node. Pass its `id` when you need to register before the element exists. Both forms work before or after `playhtml.init()`.

```js
const counter = document.getElementById("my-counter");
const handle = playhtml.register(counter, {
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
```

- The element form requires an HTML element with a stable, non-empty `id`.
- The id form binds automatically when an element with that id appears.
- The `can-play` attribute is optional. `register` supplies the custom capability.
- Re-registering the same id replaces its initializer.

:::note[Direct element properties]
Direct assignments such as `element.defaultData = …` and `element.updateElement = …` remain supported for compatibility. Use `register` for new vanilla code so the initializer stays in one object and dynamic elements bind without a separate `setupPlayElement` call.
:::

## `playhtml.define(capabilityName, init)`

Registers a reusable capability under an attribute name. Matching elements already on the page bind immediately, as do matching descendants rendered by a [view](#composition). For other elements added after initialization, call `setupPlayElement(element)`. `define` is the imperative counterpart of `init({ extraCapabilities })`.

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

The full annotated property list is on [Element API](/docs/reference/element-api/#initializer). Both `update` and `view` receive the [callback context](/docs/reference/element-api/#callback-context-ctx).

`defaultData` must be an object (or a function that returns one), not a bare value like `0` or `""`. Use `{ count: 0 }`, not `0`.

A valid initializer provides exactly one update path — `view` **or** `update`.

## The `view` context

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
  setLive(next),
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
