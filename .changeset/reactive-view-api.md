---
"playhtml": minor
"@playhtml/common": minor
---

Add a reactive `view` API for vanilla `can-play` (RFC #95). Custom capabilities can now render declaratively from state instead of hand-mutating the DOM.

**This API (`register` / `define` / `view` and the element handle) is experimental** — purely additive (the imperative `can-play`/`updateElement` path and `@playhtml/react` are unchanged), but the surface may change in a future minor based on feedback ([#95](https://github.com/spencerc99/playhtml/issues/95)).

- **`view`** — a new optional field on the capability definition. It's a pure function from state to a [lit-html](https://lit.dev/docs/libraries/standalone-templates/) template that playhtml patches into the element on every data/localData/awareness change. Mutually exclusive with `updateElement` (and with element-level `onClick`/`onDrag`, which move into the template as `@click` etc.).
- **`playhtml.register(elementId, init)`** — binds a `view`/`updateElement` initializer to a single element by id and returns a handle (`getElement`, `getData`, `setData`, `setLocalData`, `setMyAwareness`, `requestUpdate`, `unregister`) for reads/writes from outside the view. Callable before or after `init()` and before or after the element exists.
- **`playhtml.define(tagName, init)`** — registers a reusable capability under an attribute name; every element carrying it binds, including ones rendered later by a view. The imperative counterpart of `init({ extraCapabilities })`.
- **`playhtml.getHandle(elementId, capability?)`** — returns a handle for any bound element; pass the capability name to disambiguate when one element has several.
- **`requestUpdate()`** (handle + event/`onMount` context) re-runs a view without a data change, for clock-driven views (timers, relative-time labels). No-op for non-view elements.
- **`setLocalData`** now accepts a mutator function and, in view mode, re-renders — so per-user UI state lives in `localData`.
- **Composition** — a view can render mount points for other capabilities (e.g. a chat list rendering one `<div can-chat>` per room). They bind as they appear and tear down when removed from a keyed list (running `onMount` cleanup, preserving shared data), so churning lists don't leak handlers.
- **`onMount`** may return a cleanup function, run on removal/`unregister()`, so rAF loops, timers, and listeners don't leak.
- `html`, `svg`, `nothing`, `repeat`, `classMap`, and `styleMap` are re-exported from `playhtml` (lit-html ships in core; `unsafeHTML` is intentionally not re-exported so interpolated values stay auto-escaped).

Guardrails: `setData`/`setLocalData`/`setMyAwareness` called synchronously during a render are rejected (re-render-loop protection); a `setData` mutator that returns an object warns in development. Existing `updateElement`-based capabilities are unaffected — `view` is purely additive.
