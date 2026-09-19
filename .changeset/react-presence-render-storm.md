---
"@playhtml/react": patch
---

Stop cursor-presence updates from re-rendering every playhtml component on the page. PlayProvider no longer stores live cursor positions in context state (the context value is now memoized and the presence map keeps a stable identity; reactive consumers use the useCursorPresences hook, which is unchanged), and usePlayerIdentity only re-renders its consumers when the identity actually changes rather than on every presence tick. On a room with ~3,000 elements this reduced renders during a one-second drag from ~340,000 to just the elements whose data changed.
