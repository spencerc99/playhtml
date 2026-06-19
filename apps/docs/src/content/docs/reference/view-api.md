---
title: "View API (vanilla)"
description: "Types and signatures for the vanilla custom-element API: playhtml.register, playhtml.define, the view function, the element handle, and the re-exported lit-html helpers."
sidebar:
  order: 3
---

The vanilla API for building custom collaborative elements. For usage with side-by-side examples, see [Custom elements](/docs/custom-elements/); for the React equivalent, see the [React API](/docs/reference/react-api/).

```ts
import { playhtml, html, svg, repeat, classMap, styleMap, nothing } from "playhtml";
```

## `playhtml.register(elementId, init)`

Binds an initializer to one element by `id` and returns a [handle](#playelementhandle). Callable before or after `playhtml.init()` and before or after the element exists in the DOM — binding happens once both are present (like `customElements.define`).

```ts
playhtml.register<T, U, V>(
  elementId: string,
  init: ElementInitializer<T, U, V>,
): PlayElementHandle<T, U, V>;
```

- The element needs a stable, unique `id` (it _is_ the `elementId`). The `can-play` attribute is optional — `register` implies it.
- Re-registering the same id replaces its initializer.

## `playhtml.define(capabilityName, init)`

Registers a reusable capability under an attribute name. Every element carrying `[capabilityName]` binds — including ones added later, or rendered by a [view](#composition). The imperative counterpart of `init({ extraCapabilities })`.

```ts
playhtml.define<T, U, V>(capabilityName: string, init: ElementInitializer<T, U, V>): void;
```

Defining a name that collides with a built-in capability throws. Each bound element still needs a unique `id`.

## `playhtml.getHandle(elementId, capability?)`

Returns a [handle](#playelementhandle) for any bound element. Because data is keyed by capability **and** id, pass the capability name when one element carries more than one.

```ts
playhtml.getHandle(elementId: string, capability?: string): PlayElementHandle;
```

## The `init` object (`ElementInitializer`)

```ts
interface ElementInitializer<T, U, V> {
  defaultData: T | ((element: HTMLElement) => T);
  defaultLocalData?: U | ((element: HTMLElement) => U);
  myDefaultAwareness?: V | ((element: HTMLElement) => V);

  // Declarative render path — returns a lit-html template. Mutually exclusive
  // with updateElement / onClick / onDrag (put events in the template).
  view?: (ctx: ViewContext<T, U, V>) => unknown;

  // Imperative alternative — mutate the DOM yourself on each change.
  updateElement?: (ctx: ViewContext<T, U, V>) => void;

  // Lifecycle. May return a cleanup, run on removal / unregister().
  onMount?: (ctx: SetupContext<T, U, V>) => void | (() => void);

  resetShortcut?: ModifierKey;
  debounceMs?: number;
}
```

A valid initializer provides exactly one update path — `view` **or** `updateElement`. `view` is purely additive; existing `updateElement` capabilities are unchanged.

## The view context

`view` (and `updateElement`) receive:

```ts
interface ViewContext<T, U, V> {
  data: T;                         // shared, synced state (read-only snapshot)
  localData: U;                    // per-user, per-tab, un-synced state
  awareness: V[];                  // every connected user's awareness value
  awarenessByStableId: Map<string, V>;
  element: HTMLElement;            // the mount-point element

  setData(next: T | ((draft: T) => void)): void;
  setLocalData(next: U | ((draft: U) => void)): void;   // re-renders in view mode
  setMyAwareness(next: V): void;
  requestUpdate(): void;           // re-run the view now (clock-driven views)
}
```

`setData`/`setLocalData`/`setMyAwareness` must **not** be called synchronously during a render — playhtml rejects it with a console error (it's a re-render loop). Drive writes from `@event` handlers in the template or from `onMount`.

The `onMount` context is the same minus the live values, plus getters: `getData()`, `getLocalData()`, `getAwareness()`, `getElement()`, and the same `setData` / `setLocalData` / `setMyAwareness` / `requestUpdate`.

## `PlayElementHandle`

Returned by `register` and `getHandle`; reads/writes resolve the live handler lazily, so a handle obtained before binding works once it binds.

```ts
interface PlayElementHandle<T, U, V> {
  id: string;
  getElement(): HTMLElement | null;        // null until bound
  getData(): T | undefined;                // read-only snapshot
  setData(next: T | ((draft: T) => void)): void;
  setLocalData(next: U | ((draft: U) => void)): void;
  setMyAwareness(next: V): void;
  requestUpdate(): void;                   // no-op without a view
  unregister(): void;                      // detach + run onMount cleanup; data is kept
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
