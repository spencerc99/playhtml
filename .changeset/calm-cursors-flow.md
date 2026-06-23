---
"playhtml": patch
---

Improve multiplayer cursor resilience by coalescing pointer work per animation frame and adapting cursor publish rates as room size grows, while keeping cursor movement out of persistent shared data.
