---
"@playhtml/common": patch
"playhtml": patch
---

Fix room normalization: strip www. prefix so that www.example.com and example.com resolve to the same room. Use "LOCAL" identifier for file:// protocol rooms (empty host) to make them easily identifiable for cleanup. Default cursor coordinate mode changed to absolute so cursors track document position across scroll and zoom.
