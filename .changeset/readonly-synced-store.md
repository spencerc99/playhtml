---
"playhtml": patch
---

Expose `playhtml.syncedStore` as a read-only inspection view so browser scripts cannot mutate shared element data directly. Element updates still go through playhtml's normal `setData()` path, while administrative data edits remain handled by the admin console.
