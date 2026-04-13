# SPA Integration

playhtml works out of the box on full-page-reload sites. For single-page apps (SPAs) and frameworks with client-side navigation — React Router, Next.js, Astro ViewTransitions, htmx boost, Turbo — you'll want the patterns on this page so cursors, rooms, and element handlers stay consistent across navigation.

## How navigation detection works

playhtml automatically listens for:

- The browser's `navigation` API (`navigation.addEventListener("navigate")`) — fires on pushState, replaceState, and back/forward in Chromium 102+.
- `popstate` events — fires on back/forward in all browsers.

Whenever navigation is detected, playhtml rebuilds the Yjs room (if the room depends on URL), rescans the DOM for interactive elements, and refreshes cursors.

This covers most cases automatically. The sections below describe framework-specific integrations for cases auto-detection can't cover.

## React Router / Next.js / any React router

Pass your current pathname to `PlayProvider`:

```tsx
// React Router
import { useLocation } from "react-router-dom";

function App() {
  const { pathname } = useLocation();
  return (
    <PlayProvider initOptions={{...}} pathname={pathname}>
      {/* ... */}
    </PlayProvider>
  );
}

// Next.js App Router
"use client";
import { usePathname } from "next/navigation";

function Providers({ children }) {
  const pathname = usePathname();
  return (
    <PlayProvider initOptions={{...}} pathname={pathname}>
      {children}
    </PlayProvider>
  );
}
```

When `pathname` changes, playhtml refreshes. On Chromium, the browser's navigation API fires first and the prop-based call collapses into a no-op. On Safari and Firefox, the prop is load-bearing because neither browser has shipped the Navigation API yet.

## Cursor container (surviving body-swaps)

Astro ViewTransitions, htmx boost, and Turbo swap `document.body` on navigation. Cursor DOM appended to body gets destroyed along with the rest. Fix: provide a `container` element you mark with the framework's persist directive.

```astro
<!-- Astro with ViewTransitions -->
<div id="cursor-layer" transition:persist></div>

<script>
  import { playhtml } from "@playhtml/playhtml";
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
<PlayProvider initOptions={{
  cursors: {
    enabled: true,
    container: cursorLayerRef,
  },
}}>
  <div ref={cursorLayerRef} className="cursor-layer" />
  {/* app */}
</PlayProvider>
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

## Destroy

```ts
await playhtml.destroy();
```

Removes all playhtml DOM, listeners, and connections. `init()` may be called again afterward with fresh options.
