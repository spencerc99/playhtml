---
"playhtml": minor
"@playhtml/react": patch
---

`playhtml.isLoading` and `playhtml.ready` now follow room switches. When client-side navigation moves to a different room (or the server resets the room), `isLoading` turns `true` and `ready` becomes a new promise until the new room has synced, instead of reporting the old room as ready while the new one is still loading. playhtml also dispatches a `playhtml:loading-change` event on `document` whenever `isLoading` flips. In React, `usePlayContext().isLoading` follows the same switch.

This also fixes loading styles that never applied: `loading-behavior="hidden"`, `loading-behavior="animate"` on custom elements, and `loading-style="pulse"` / `"breathing"` now take effect while an element loads. Setting `loading-style` or `loading-class` on a custom element (`can-play`, `withSharedState`) now turns its loading treatment on; before, custom elements ignored them unless `loading-behavior` was also set.
