---
"playhtml": patch
---

Improve multiplayer cursor resilience by coalescing pointer work per animation frame, adapting cursor publish rates as active cursor load grows, expiring stale cursor positions, and keeping cursor movement out of persistent shared data. Element awareness now also publishes stable player identity metadata before custom awareness fields so presence-only users dedupe by public identity.
