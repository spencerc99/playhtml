---
"playhtml": patch
---

Element awareness (`setMyAwareness` / `updateElementAwareness`) now syncs over the generic realtime presence transport, always scoped to the element's page room — including when `cursors.room` is set to `domain` or another non-page scope. When the cursor room and page room coincide the two share one presence socket; otherwise element awareness opens its own page-scoped socket. The previous Yjs-awareness path remains as an automatic fallback when WebSocket is unavailable. No public API changes.
