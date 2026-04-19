---
title: "Using React"
description: "A five-minute orientation to @playhtml/react, then let every concept page show you the React form."
sidebar:
  order: 3
---

playhtml ships a first-class React package. This page is an orientation; the rest of the docs show you the React form of each concept inline, next to the vanilla HTML form, so you can pick the shape that fits your codebase.

## Install

```bash
npm install @playhtml/react
```

Compatible with React 16.8 and above, including React 17, 18, and 19.

## Wrap your app

Every React app using playhtml needs a single `<PlayProvider>` near the root. It initializes the client and opens the connection. Anything you'd pass to `playhtml.init()` goes in `initOptions`.

```tsx
import { PlayProvider } from "@playhtml/react";

export default function App() {
  return (
    <PlayProvider
      initOptions={{
        // room: "my-room",
        // cursors: { enabled: true },
      }}
    >
      <YourApp />
    </PlayProvider>
  );
}
```

A new page / route in a multi-page app needs its own provider only if it's a separate React root; for most apps `PlayProvider` wraps your entire tree once.

## Two building blocks

Almost every React element in playhtml is built from one of these.

### `withSharedState` — a hook-flavored HOC

Wrap a component to give it live, shared `data` plus a `setData` callback.

```tsx
import { withSharedState } from "@playhtml/react";

export const ToggleSquare = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }) => (
    <div
      style={{ background: data.on ? "green" : "red", width: 200, height: 200 }}
      onClick={() => setData({ on: !data.on })}
    />
  ),
);
```

Pass a callback instead of an object if the default data depends on props:

```tsx
export const ReactionView = withSharedState(
  ({ reaction: { count } }) => ({ defaultData: { count } }),
  ({ data, setData }, { reaction: { emoji } }) => (
    <button onClick={() => setData({ count: data.count + 1 })}>
      {emoji} {data.count}
    </button>
  ),
);
```

Add `myDefaultAwareness` to the config to get presence-style ephemeral per-user data alongside your persistent data.

### `<CanPlayElement>` — for when you need JSX children, not a wrapper

Same idea, different shape. Useful when the thing you're wrapping is a specific DOM element you want to keep named, or when you want access to `ref`.

```tsx
import { CanPlayElement } from "@playhtml/react";
import { TagType } from "@playhtml/common";

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
</CanPlayElement>;
```

## Where to go next

Every concept page shows both the vanilla and React forms. Pick whichever matches your codebase:

- [Core concepts](/docs/concepts/) — the four primitives
- [Data essentials](/docs/data/data-essentials/) — `setData` semantics and data shape
- [Presence](/docs/data/presence/) — ephemeral per-user state, including cursors
- [Events](/docs/data/events/) — one-off broadcasts
- [Capabilities](/docs/capabilities/) — every built-in `can-*` attribute

For the full React component/hook signatures and types, see [React API](/docs/reference/react-api/).
