---
"playhtml": patch
---

Improve multiplayer cursor resilience by coalescing pointer work per animation frame and adapting cursor awareness update rates as room size grows, while keeping cursor movement in ephemeral awareness instead of persistent shared data.
