---
"@playhtml/react": patch
---

Make `withSharedState` use its configured `id` when a rendered child also provides a different DOM id, and warn about the conflict so shared state binds to the intended element.
