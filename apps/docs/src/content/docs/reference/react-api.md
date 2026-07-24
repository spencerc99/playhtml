---
title: "React API"
description: "Types and signatures for @playhtml/react: PlayProvider, withSharedState, capability components, hooks, and usePlayContext."
sidebar:
  order: 7
---

The full type surface of `@playhtml/react`. For a gentler introduction, see [Using React](/docs/using-react/). For concept-by-concept usage, each page under _Data_ and _Capabilities_ has a React tab alongside the vanilla form.

## `<PlayProvider>`

Initializes the playhtml client for a React subtree. There must be exactly one `PlayProvider` per React root.

```tsx
interface PlayProviderProps {
  initOptions?: InitOptions;
  pathname?: string;
  children: React.ReactNode;
}
```

Everything in `initOptions` maps one-to-one onto the vanilla `playhtml.init()` argument. See the [init options reference](/docs/reference/init-options/).

`pathname` is optional and only needed for client-side-navigation frameworks (React Router, Next.js, etc.) where the browser Navigation API isn't available. Pass it from your router and playhtml will rebuild rooms + rescan the DOM on pathname changes. See [navigation](/docs/advanced/navigation/) for details.

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

- **`defaultData`**: required. The initial value of `data`. Survives reload.
- **`myDefaultAwareness`**: optional. Initial value for this user's element awareness. This is ephemeral per-user presence scoped to the element. Does _not_ persist.
- **`id`**: optional. Stable id for the element. If omitted, playhtml derives one from the rendered DOM; see [Dynamic elements](/docs/advanced/dynamic-elements/) for why stable ids matter.
- **`tagInfo`**: optional. Marks the element as one of the built-in capabilities (e.g. `[TagType.CanToggle]`). See [Capabilities](/docs/capabilities/).

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

`awareness`, `myAwareness`, and `setMyAwareness` are the element-scoped form of [presence](/docs/data/presence/#element-awareness). Use them for live per-user signals tied to this element, not state that should survive reload.

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
  loading?: LoadingOptions;
  dataSource?: string;
  shared?: boolean | string;
  dataSourceReadOnly?: boolean;
  children: (props: ReactElementEventHandlerData<T, V>) => React.ReactNode;
}
```

- **`id`**: required if the top-level child is a React Fragment. Otherwise defaults to the child's id, or a hash of the child's content. A stable id matters for cross-browser sync; see [Dynamic elements](/docs/advanced/dynamic-elements/).
- **`myDefaultAwareness`**: optional. Initial element awareness for this user. Same lifetime as presence; it clears when the user leaves.
- **`standalone`**: when `true`, the element initializes playhtml itself if no `PlayProvider` is present. Use it for one-off components mounted outside your provider tree (e.g. an Astro island). A no-op when a provider already exists.
- **`loading`**: controls the loading affordance shown before the element's first sync. See [Loading options](#loading-options).
- **`dataSource`**, **`shared`**, **`dataSourceReadOnly`**: wire the element to a shared source across pages or sites. See [Shared data props](#shared-data-props) and the [Shared elements](/docs/advanced/shared-elements/) guide.

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

## `<CanMoveElement>`

Typed wrapper around `CanPlayElement` for draggable elements. Accepts the same `dataSource`, `shared`, and `standalone` props, plus three bounds props for constraining the drag area.

```tsx
interface CanMoveElementProps {
  bounds?: string;
  boundsMinVisible?: number;
  boundsMinVisiblePx?: number;
  dataSource?: string;
  shared?: boolean | string;
  standalone?: boolean;
  children: React.ReactElement | ((data: MoveEventData) => React.ReactElement);
}
```

- **`bounds`**: id or CSS selector of the container that constrains dragging. `"arena"`, `"#arena"`, and `".grid"` all work.
- **`boundsMinVisible`**: fraction (`0–1`) of the element that must stay inside `bounds` on every edge. Default `1`, which keeps the full element inside. Lower values allow part of the element to hang over the edge; `0` drops the fraction constraint entirely.
- **`boundsMinVisiblePx`**: absolute pixel floor on the keep-visible slice. Default `60`; it applies when `boundsMinVisible` allows partial overhang.

Bounds apply only during dragging. Setup does not rewrite the element's initial CSS layout or persisted position.

The effective keep-visible slice on each axis is `max(boundsMinVisible × size, boundsMinVisiblePx)`. Set both knobs to `0` to opt fully out of the keep-visible guarantee. See [`can-move` in the capabilities reference](/docs/capabilities/#can-move) for the interaction details.

```tsx
import { CanMoveElement } from "@playhtml/react";

<div id="fridge" style={{ position: "relative", height: 400 }}>
  <CanMoveElement bounds="fridge">
    <div id="magnet-a">🍎</div>
  </CanMoveElement>
  <CanMoveElement bounds="fridge" boundsMinVisible={0.5} boundsMinVisiblePx={0}>
    <div id="magnet-b">🥐</div>
  </CanMoveElement>
</div>;
```

## Other capability components

Each built-in capability has a typed wrapper. All of them accept the shared `dataSource`, `shared`, and `standalone` props (see [Shared data props](#shared-data-props)); the table lists what's unique to each. For the full set of options including `loading` and `dataSourceReadOnly`, use `<CanPlayElement>` or `withSharedState`; the capability wrappers only forward the three props above.

| Component | Capability | Extra props |
| --- | --- | --- |
| `<CanToggleElement>` | `can-toggle` | `readOnly?: boolean`: render the toggle read-only (sets `data-source-read-only`). |
| `<CanSpinElement>` | `can-spin` | none |
| `<CanGrowElement>` | `can-grow` | none |
| `<CanHoverElement>` | `can-hover` | sets `[data-playhtml-hover]` on its child while any user hovers; style that attribute instead of `:hover`. |
| `<CanDuplicateElement>` | `can-duplicate` | `elementToDuplicate: RefObject<HTMLElement>` (required), `canDuplicateTo?: RefObject<HTMLElement>`. |

`CanDuplicateElement` takes refs rather than selector strings, since React owns the DOM:

```tsx
import { CanDuplicateElement } from "@playhtml/react";

const template = useRef<HTMLImageElement>(null);
const bin = useRef<HTMLDivElement>(null);

<>
  <img ref={template} id="bunny-template" src="/pixel-bunny.png" />
  <CanDuplicateElement elementToDuplicate={template} canDuplicateTo={bin}>
    <button>clone a bunny</button>
  </CanDuplicateElement>
  <div ref={bin} />
</>;
```

For the live demos of each capability, see the [Capabilities](/docs/capabilities/) page. Every section has a React tab.

## Shared data props

These props let an element participate in [cross-page / cross-site sharing](/docs/advanced/shared-elements/). They mirror the vanilla HTML attributes.

| Prop | HTML attribute | Where it works |
| --- | --- | --- |
| `shared` | `shared` | `CanPlayElement` and every capability wrapper. Mark this element as a **source** others can subscribe to. `true` is read-write; pass `"read-only"` to publish read-only. |
| `dataSource` | `data-source` | `CanPlayElement` and every capability wrapper. Subscribe to a source as a **consumer**. Format: `"domain[/path]#elementId"`. |
| `dataSourceReadOnly` | `data-source-read-only` | `CanPlayElement` / `withSharedState` only. Force a consumer to read-only even if the source is read-write. (On `CanToggleElement`, use its `readOnly` prop, which sets the same attribute.) |

```tsx
// Source — publishes its toggle state for any page to consume
<CanToggleElement id="lamp" shared>
  <button>lamp</button>
</CanToggleElement>

// Consumer — mirrors the lamp from another page, read-only via the toggle's readOnly prop
<CanToggleElement dataSource="playhtml.fun/#lamp" readOnly>
  <button>lamp (mirror)</button>
</CanToggleElement>
```

## Loading options

`CanPlayElement` and `withSharedState` accept a `loading` prop controlling the affordance shown before the element's first sync from the server (it's hidden or animated so readers don't see a flash of default state). The vanilla equivalents are the `loading-behavior` / `loading-class` / `loading-style` HTML attributes, which work on any playhtml element.

```tsx
interface LoadingOptions {
  behavior?: "auto" | "hidden" | "animate" | "none";
  customClass?: string;
  style?: "breathing" | "pulse" | "fade" | "none";
}
```

- **`behavior`**: `"auto"` (default) picks a reasonable affordance, `"hidden"` keeps the element invisible until synced, `"animate"` shows the loading animation, `"none"` disables the affordance entirely (element renders its default state immediately).
- **`customClass`**: a CSS class applied while loading, so you can style the placeholder yourself.
- **`style`**: the built-in loading animation: `"breathing"`, `"pulse"`, `"fade"`, or `"none"`.

```tsx
<CanPlayElement
  tagInfo={[TagType.CanToggle]}
  id="lamp"
  defaultData={{ on: false }}
  loading={{ behavior: "animate", style: "pulse" }}
>
  {({ data, setData }) => (
    <button onClick={() => setData({ on: !data.on })}>lamp</button>
  )}
</CanPlayElement>
```

## `usePlayContext()`

Access the playhtml context from any descendant of `PlayProvider`.

```tsx
interface PlayContextValue {
  isLoading: boolean;
  cursors: CursorEvents;
  cursorPresences: Map<string, CursorPresenceView>;
  configureCursors: (opts: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => PlayerIdentity | null;
  registerPlayEventListener: (type: string, handler: PlayEvent) => string;
  removePlayEventListener: (type: string, id: string) => void;
  dispatchPlayEvent: (msg: { type: string; eventPayload?: unknown }) => void;
}
```

Most consumers don't read the raw context. Prefer the dedicated hooks ([`usePresence`](#usepresence), [`usePageData`](#usepagedata), [`useCursorPresences`](#usecursorpresences), [`usePlayerIdentity`](#useplayeridentity)) which subscribe and re-render for you.

### `isLoading`

Boolean that is `true` until the initial state from the server has landed, then flips to `false`. Gate effects that should run once per synced session on it:

```tsx
const { isLoading } = usePlayContext();
const didCountSession = useRef(false);

useEffect(() => {
  if (isLoading || didCountSession.current) return;
  didCountSession.current = true;

  setData((draft) => {
    draft.count += 1;
  });
}, [isLoading, setData]);
```

Use a ref guard plus the mutator form for this kind of write, and don't include the field you write in the dependency list.

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

Usually you'll wrap these in a hook to bind a listener to the component's lifecycle. See [Events](/docs/data/events/) for the `useConfetti` pattern.

## Hooks

All hooks must be used inside a `PlayProvider`. Each is safe to call before playhtml has finished initializing: it returns an empty/default value, and any setter warns and no-ops until sync completes, then wires up automatically. You never need to gate them on a loading flag yourself.

### `usePresence`

Subscribe to a custom [presence](/docs/data/presence/) channel. Returns the live map of everyone's presence, a setter for your own, and your identity.

```tsx
function usePresence<T = Record<string, unknown>>(channel: string): {
  presences: Map<string, PresenceView<T>>;
  setMyPresence: (data: T) => void;
  myIdentity: PlayerIdentity | null;
};
```

```tsx
const { presences, setMyPresence } = usePresence<{ text: string }>("status");
setMyPresence({ text: "focused" });
// presences is keyed by stable id; each value has isMe, playerIdentity, cursor,
// plus your channel data nested under the channel name:
for (const [, p] of presences) {
  p.isMe;          // boolean
  p.status?.text;  // your channel value, keyed by the channel name ("status")
}
```

The type parameter is an assertion about your channel's shape; no runtime validation is performed. Note your data lives under the channel key (`p.status`), not flattened onto the view.

### `usePageData`

Subscribe to a [page-level data channel](/docs/data/page-data/), persistent state not tied to any element. The shape mirrors `useState`.

```tsx
type PageDataSetter<T> = T extends object
  ? T | ((draft: T) => void)
  : T | ((value: T) => T);

function usePageData<T>(
  name: string,
  defaultValue: T,
): [T, (data: PageDataSetter<T>) => void];
```

```tsx
const [counter, setCounter] = usePageData("visits", { count: 0 });
setCounter((draft) => { draft.count += 1; });
```

For primitive channels, a functional update returns the next value:

```tsx
const [viewCount, setViewCount] = usePageData("viewCount", 0);
setViewCount((value) => value + 1);
```

`defaultValue` is read only on first mount and when `name` changes. `setCounter` accepts a replacement value or a mutator function. Object and array mutators edit their draft in place; primitive updaters return the next value.

### `usePresenceRoom`

Join an isolated [presence room](/docs/data/presence/) separate from the page's main presence. Returns `null` until synced (and briefly during a room change).

```tsx
function usePresenceRoom(name: string): PresenceRoom | null;
```

```tsx
const room = usePresenceRoom("lobby");
room?.presence.setMyPresence("status", { text: "ready" });
```

The room and its connection are torn down automatically when the component unmounts or `name` changes.

### `useCursorPresences`

Read the live map of cursor presences (stable id → `CursorPresenceView`). Re-renders when cursors move. Requires `cursors: { enabled: true }`.

```tsx
function useCursorPresences(): Map<string, CursorPresenceView>;
```

### `useCursorZone`

Register an element as a cursor zone. When the local user's cursor is inside it, other clients render the cursor positioned relative to their own copy of the same element (matched by element id). This anchors cursors to a shared widget rather than absolute page coordinates.

```tsx
function useCursorZone(
  ref: RefObject<HTMLElement | null>,
  options?: CursorZoneOptions,
): void;
```

```tsx
const ref = useRef<HTMLDivElement>(null);
useCursorZone(ref);
return <div ref={ref} id="shared-canvas" />; // the element needs a stable id
```

### `usePlayerIdentity`

Read the local player's cursor color, participant id, and name. Requires `cursors: { enabled: true }`.

```tsx
function usePlayerIdentity(): {
  color: string;
  pid: string | undefined;
  name: string | undefined;
};
```

| Field | Type | Notes |
| --- | --- | --- |
| `color` | `string` | Primary cursor color. |
| `pid` | `string \| undefined` | Participant id (`publicKey`). `undefined` until cursors sync. |
| `name` | `string \| undefined` | Display name, if set. |

```tsx
import { usePlayerIdentity } from "@playhtml/react";

function Profile() {
  const { color, pid, name } = usePlayerIdentity();
  return <div style={{ color }}>{name ?? "anonymous"}</div>;
}
```

Values update reactively. With the "we were online" extension installed, color and `pid` reflect the extension's injected identity.

See [Presence & identity](/docs/reference/presence/) for the underlying `PlayerIdentity` type.

## `TagType`

Re-exported from `playhtml`. Use these as `tagInfo` entries when you want a built-in capability (`can-move`, `can-toggle`, etc.) wired into your component.

```ts
import { TagType } from "playhtml";

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

- **Per-key persistence config.** Currently persistence is a whole-store choice: `setMyAwareness` for element-scoped presence, `setData` for persistent data, no local-only mode. A future `persistenceOptions` object might let you configure per-key (`none` / `local` / `global`).
- **`awareness` splitting.** `awareness` currently includes the local user; it may split into `myAwareness` + `othersAwareness` for clarity.
- **Hook ergonomics.** A pure-hook interface (`useSharedState({ id, defaultData })`) is being evaluated as an alternative to the HOC form. The blocker is that hooks have no natural place to pin a stable `id`.
