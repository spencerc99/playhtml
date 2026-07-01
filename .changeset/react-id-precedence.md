---
"@playhtml/react": patch
---

Make `withSharedState` use its configured `id` when a rendered child also provides a different DOM id, clean up changed id bindings, and report id conflicts without repeated or misleading warnings.
