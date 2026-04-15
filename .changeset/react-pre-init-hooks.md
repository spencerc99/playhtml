---
"@playhtml/react": minor
---

Add `usePresence`, `usePageData`, and `usePresenceRoom` hooks that are safe to call before playhtml has finished initializing. They return empty/default values and no-op setters until sync completes, then wire up automatically — no `hasSynced` guards needed at call sites.

Also adds `isLoading` to `PlayContext` as the preferred way to check init state. `hasSynced` is still present (inverse semantics) but deprecated.
