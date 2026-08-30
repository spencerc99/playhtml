---
"@playhtml/react": patch
---

Fix two bugs in `@playhtml/react`: function-form `defaultData`/`myDefaultAwareness` (e.g. `(el) => ({ text: el.id })`) was resolved against `null` during the first render instead of the real element, crashing on mount — it now resolves once the element is attached. Also, `usePresence().myIdentity` used to freeze at sync completion and never reflect a later identity change (e.g. the "we were online" extension injecting identity post-sync); it now updates reactively like `usePlayerIdentity`.
