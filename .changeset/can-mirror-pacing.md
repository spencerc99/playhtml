---
"playhtml": patch
---

Coalesce can-mirror DOM observer writes before syncing so many simultaneous element mutations send a single shared document update instead of one update per element.
