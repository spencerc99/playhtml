---
title: "Navigation & SPAs"
description: "How playhtml handles client-side navigation — React Router, Next.js, Astro ViewTransitions, htmx boost, Turbo."
sidebar:
  order: 4
---

playhtml works out of the box on full-page-reload sites. For single-page apps (SPAs) and frameworks with client-side navigation — React Router, Next.js, Astro ViewTransitions, htmx boost, Turbo — you'll want the patterns on this page so cursors, rooms, and element handlers stay consistent across navigation.

## How navigation detection works

playhtml automatically listens for:

- The browser's `navigation` API (`navigation.addEventListener("navigate")`) — fires on pushState, replaceState, and back/forward in Chromium 102+.
- `popstate` events — fires on back/forward in all browsers.

Whenever navigation is detected, playhtml recomputes the room. If it changed, playhtml reconnects to the new room, rescans the DOM for interactive elements, and refreshes cursors. **On a room change the document's data resets to the new room** (see [Room-scoped data](#room-scoped-data-on-navigation) below).

This covers most cases automatically. The sections below describe framework-specific integrations for cases auto-detection can't cover.

## Picking the room

The default room is derived from the URL pathname, so it recomputes automatically on navigation. To control it yourself, pass `room` to `init`:

```ts
// Static string — fixed across navigation until init() receives another room.
playhtml.init({ room: "my-app" });

// Function — re-invoked on every navigation, so a URL-derived room follows the
// route the same way the default room does. Use this for custom per-page rooms.
playhtml.init({ room: () => `notes${window.location.pathname}` });
```

A static string stays fixed across navigation until you call `init()` again with another room (good for a single shared room). A function is called at init and again on each navigation, so the room can follow the URL.

## Room-scoped data on navigation

Data in playhtml — both element data (`can-move`, `can-toggle`, …) and page data (`createPageData`) — is scoped to the room. When navigation **changes the room**, the document re-initializes so the new room starts from a clean state: the old room's data does not carry over, and your code re-creates / re-registers it for the new room exactly as on a fresh page load.

When navigation does **not** change the room — a hash change, a static explicit room, or a path that maps to the same room — nothing resets and data persists across the route change.

This reset discards the in-memory document and rebuilds it; it never deletes from the previous room, so a previous room's persisted data is never modified by navigating away and back.

## React Router / Next.js / any React router

Pass your current pathname to `PlayProvider`:

```tsx
// React Router
import { useLocation } from "react-router-dom";

function App() {
  const { pathname } = useLocation();
  return (
    <PlayProvider initOptions={{ /* ... */ }} pathname={pathname}>
      {/* ... */}
    </PlayProvider>
  );
}
```

```tsx
// Next.js App Router
"use client";
import { usePathname } from "next/navigation";

function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <PlayProvider initOptions={{ /* ... */ }} pathname={pathname}>
      {children}
    </PlayProvider>
  );
}
```

When `pathname` changes, playhtml refreshes. On Chromium, the browser's navigation API fires first and the prop-based call collapses into a no-op. On Safari and Firefox the prop is load-bearing because neither browser has shipped the Navigation API yet.

## Cursor container (surviving body-swaps)

Astro ViewTransitions, htmx boost, and Turbo swap `document.body` on navigation. Cursor DOM appended to body gets destroyed along with the rest. Fix: provide a `container` element you mark with the framework's persist directive.

```astro
<!-- Astro with ViewTransitions -->
<div id="cursor-layer" transition:persist></div>

<script>
  import { playhtml } from "playhtml";
  playhtml.init({
    cursors: {
      enabled: true,
      container: "#cursor-layer",
    },
  });
</script>
```

```tsx
// React
const cursorLayerRef = useRef<HTMLDivElement>(null);

<PlayProvider
  initOptions={{
    cursors: {
      enabled: true,
      container: cursorLayerRef,
    },
  }}
>
  <div ref={cursorLayerRef} className="cursor-layer" />
  {/* app */}
</PlayProvider>;
```

`container` accepts:

- An `HTMLElement`.
- A CSS selector string (`"#cursor-layer"`).
- A getter function `() => HTMLElement | null`.
- In React, a `RefObject`.

The getter form is re-evaluated whenever playhtml needs the container, so it handles containers that mount late or change over time.

Cursor CSS is injected into the container too, so `transition:persist` carries everything together.

## htmx + hx-boost

htmx boost does client-side navigation without a framework-level hook. Call `handleNavigation()` from `htmx:afterSwap`:

```html
<script>
  document.addEventListener("htmx:afterSwap", () => {
    playhtml.handleNavigation();
  });
</script>
```

## Astro ViewTransitions

The default auto-detection handles this because Astro fires `popstate`. You only need the `container` option for cursor persistence.

## Events

- `playhtml:navigated` — fires on `document` after each successful navigation handling, with `event.detail.room` set to the current room ID.

## Handles held across navigation

A `createPageData` handle you keep across a room-changing navigation stays usable: it reads the new room's data (its default until re-seeded), its `setData` still writes, and its `onUpdate` keeps firing. You don't have to re-create channels on navigation, though doing so is also fine — a re-created channel and a surviving handle for the same name share one live channel in the new room.
