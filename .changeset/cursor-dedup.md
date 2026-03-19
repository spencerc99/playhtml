---
"playhtml": patch
---

Fix phantom duplicate cursors when same user has multiple tabs open on the same URL. Cursors are now deduplicated by publicKey instead of Yjs clientId. Also fixes scroll lag for inactive cursors by switching absolute-mode cursors to position:absolute (browser-native scroll compositing) and replacing the 150ms scroll debounce with requestAnimationFrame throttle.
