---
"playhtml": minor
"@playhtml/react": minor
---

SPA navigation compatibility. playhtml now detects client-side navigation (Astro ViewTransitions, React Router, Next.js, htmx boost, Turbo) via the browser's Navigation API and `popstate`, rebuilding rooms and rescanning the DOM as URLs change.

New public API:

- `playhtml.handleNavigation()` — manual trigger for routers that bypass both Navigation API and `popstate`.
- `playhtml.destroy()` — symmetric teardown; `init()` may be called again afterward.
- `CursorOptions.container` accepts `HTMLElement | string | (() => HTMLElement | null)` — cursor DOM and styles mount inside this element, so marking it with `transition:persist` (or equivalent) keeps cursors across body-swaps.
- `<PlayProvider>` accepts a `pathname` prop that calls `playhtml.handleNavigation()` when it changes, and a `RefObject` for `cursors.container`.
- `playhtml:navigated` CustomEvent fires on `document` after each navigation, with `detail.room`.

See `docs/spa-integration.md` for framework-specific usage.
