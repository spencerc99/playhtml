---
"playhtml": minor
"@playhtml/common": minor
---

Add a reactive `view` API for vanilla `can-play` (RFC #95). Custom capabilities can now render declaratively from state instead of hand-mutating the DOM:

- **`view`** — a new optional field on the capability definition. It's a pure function from state to a [lit-html](https://lit.dev/docs/libraries/standalone-templates/) template that playhtml patches into the element on every data/localData/awareness change. Mutually exclusive with `updateElement` (and with element-level `onClick`/`onDrag`, which move into the template as `@click` etc.).
- **`playhtml.register(elementId, init)`** — binds a `view`/`updateElement` initializer to a single element by id and returns a handle (`getElement`, `getData`, `setData`, `setLocalData`, `setMyAwareness`, `requestUpdate`, `unregister`) for reads/writes from outside the view. Callable before or after `init()` and before or after the element exists.
- **`playhtml.define(tagName, init)`** — registers a reusable capability under an attribute name; every element carrying it binds, including ones rendered later by a view. The imperative counterpart of `init({ extraCapabilities })`.
- **`playhtml.getHandle(elementId)`** — returns a handle for any bound element.
- **`requestUpdate()`** (handle + event/`onMount` context) re-runs a view without a data change, for clock-driven views (timers, relative-time labels).
- **`setLocalData`** now accepts a mutator function and, in view mode, re-renders — so per-user UI state lives in `localData`.
- `html`, `svg`, `nothing`, `repeat`, `classMap`, and `styleMap` are re-exported from `playhtml` (lit-html ships in core; `unsafeHTML` is intentionally not re-exported so interpolated values stay auto-escaped).

Guardrails: `setData` called synchronously during a render is rejected (re-render-loop protection), and a `setData` mutator that returns a value warns in development. Existing `updateElement`-based capabilities are unaffected — `view` is purely additive.
