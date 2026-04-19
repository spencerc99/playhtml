---
title: "React API"
description: "Types and signatures for @playhtml/react — PlayProvider, withSharedState, CanPlayElement, usePlayContext."
sidebar:
  order: 2
---

The full type surface of `@playhtml/react`. For a gentler introduction, see [Using React](/docs/using-react/). For concept-by-concept usage, each page under _Data_ and _Capabilities_ has a React tab alongside the vanilla form.

## `<PlayProvider>`

Initializes the playhtml client for a React subtree. There must be exactly one `PlayProvider` per React root.

```tsx
interface PlayProviderProps {
  initOptions?: InitOptions;
  children: React.ReactNode;
}
```

Everything in `initOptions` maps one-to-one onto the vanilla `playhtml.init()` argument — see the [init options reference](/docs/reference/init-options/).

```tsx
import { PlayProvider } from "@playhtml/react";

<PlayProvider initOptions={{ cursors: { enabled: true } }}>
  <App />
</PlayProvider>;
```

## `withSharedState(config, render)`

HOC that returns a component with live, shared `data` plus a `setData` callback. The config controls how the element is wired into playhtml; the render function is a regular functional component that receives playhtml's state as its first argument and your own props as its second.

### Signatures

```tsx
withSharedState<T, V, P>(
  config: WithSharedStateConfig<T, V> | ((props: P) => WithSharedStateConfig<T, V>),
  render: (
    playhtmlProps: ReactElementEventHandlerData<T, V>,
    componentProps: P,
  ) => React.ReactNode,
): React.ComponentType<P>;
```

### Config shape

```tsx
interface WithSharedStateConfig<T, V> {
  defaultData: T;
  myDefaultAwareness?: V;
  id?: string;
  tagInfo?: TagType[];
}
```

- **`defaultData`** — required. The initial value of `data`. Survives reload.
- **`myDefaultAwareness`** — optional. Initial value for this user's ephemeral per-user field. Does _not_ persist.
- **`id`** — optional. Stable id for the element. If omitted, playhtml derives one from the rendered DOM; see [Dynamic elements](/docs/advanced/dynamic-elements/) for why stable ids matter.
- **`tagInfo`** — optional. Marks the element as one of the built-in capabilities (e.g. `[TagType.CanToggle]`). See [Capabilities](/docs/capabilities/).

### Render-function props

```tsx
interface ReactElementEventHandlerData<T, V> {
  data: T;
  setData: (data: T | ((draft: T) => void)) => void;
  awareness: V[];
  myAwareness?: V;
  setMyAwareness: (data: V) => void;
  ref: React.RefObject<HTMLElement>;
}
```

`setData` accepts either a replacement value or a mutator function. See [Data essentials](/docs/data/data-essentials/) for the merge semantics.

### Props-dependent config

Pass a callback instead of a config object when `defaultData` needs to derive from props:

```tsx
export const Reaction = withSharedState(
  ({ reaction: { count } }) => ({ defaultData: { count } }),
  ({ data, setData }, props) => /* … */,
);
```

## `<CanPlayElement>`

Component form of `withSharedState`. Useful when you want JSX children (render-prop style) instead of wrapping a component, or when you need ref access to a specific element.

```tsx
interface CanPlayElementProps<T, V> {
  id?: string;
  defaultData: T;
  myDefaultAwareness?: V;
  tagInfo?: TagType[];
  standalone?: boolean;
  children: (props: ReactElementEventHandlerData<T, V>) => React.ReactNode;
}
```

- **`id`** — required if the top-level child is a React Fragment. Otherwise defaults to the child's id, or a hash of the child's content.
- **`standalone`** — when `true`, this element doesn't inherit defaults from any built-in capability (it's a pure `can-play` element).

```tsx
<CanPlayElement
  tagInfo={[TagType.CanToggle]}
  id="my-lamp"
  defaultData={{ on: false }}
>
  {({ data, setData }) => (
    <button onClick={() => setData({ on: !data.on })}>
      {data.on ? "on" : "off"}
    </button>
  )}
</CanPlayElement>
```

## `usePlayContext()`

Access the playhtml context from any descendant of `PlayProvider`.

```tsx
interface PlayContextValue {
  hasSynced: boolean;
  cursors: CursorsView;
  configureCursors: (opts: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => PlayerIdentity;
  registerPlayEventListener: (type: string, handler: PlayEvent) => string;
  removePlayEventListener: (type: string, id: string) => void;
  dispatchPlayEvent: (msg: { type: string; payload?: unknown }) => void;
}
```

### `hasSynced`

Boolean that flips to `true` once the initial state from the server has landed. Useful for gating effects that should run exactly once per synced session:

```tsx
const { hasSynced } = usePlayContext();
useEffect(() => {
  if (hasSynced) setData({ count: data.count + 1 });
}, [hasSynced]);
```

### `cursors`

A reactive view of the cursor system. Components using this re-render when colors or identities change.

```tsx
const { cursors } = usePlayContext();
// cursors.allColors: string[]
// cursors.color: string
// cursors.name: string
```

See [Cursors](/docs/data/presence/cursors/) for the full cursor configuration surface.

### Event API

```tsx
const {
  registerPlayEventListener,
  removePlayEventListener,
  dispatchPlayEvent,
} = usePlayContext();
```

Usually you'll wrap these in a hook to bind a listener to the component's lifecycle — see [Events](/docs/data/events/) for the `useConfetti` pattern.

## `TagType`

Re-exported from `@playhtml/common`. Use these as `tagInfo` entries when you want a built-in capability (`can-move`, `can-toggle`, etc.) wired into your component.

```ts
import { TagType } from "@playhtml/common";

TagType.CanPlay;
TagType.CanMove;
TagType.CanToggle;
TagType.CanGrow;
TagType.CanSpin;
TagType.CanHover;
TagType.CanDuplicate;
TagType.CanMirror;
```

## Examples

The repo has a collection of runnable React examples at [`packages/react/examples`](https://github.com/spencerc99/playhtml/tree/main/packages/react/examples). Live versions are visible at [playhtml.fun/experiments/one/](https://playhtml.fun/experiments/one/) and [playhtml.fun/experiments/two/](https://playhtml.fun/experiments/two/).

## Open considerations

A few things still in flux in the React package:

- **Per-key persistence config.** Currently persistence is a whole-store choice: `setMyAwareness` for ephemeral, `setData` for persistent, no local-only mode. A future `persistenceOptions` object might let you configure per-key (`none` / `local` / `global`).
- **`awareness` splitting.** `awareness` currently includes the local user; it may split into `myAwareness` + `othersAwareness` for clarity.
- **Hook ergonomics.** A pure-hook interface (`useSharedState({ id, defaultData })`) is being evaluated as an alternative to the HOC form. The blocker is that hooks have no natural place to pin a stable `id`.
