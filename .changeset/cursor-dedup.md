---
"playhtml": patch
---

Fix phantom duplicate cursors when same user has multiple tabs open on the same URL. Cursors are now deduplicated by publicKey instead of Yjs clientId.
