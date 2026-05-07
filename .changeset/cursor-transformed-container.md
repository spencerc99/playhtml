---
"playhtml": patch
---

Cursors now anchor to content when the cursor `container` has its own CSS transform (e.g. a pannable, zoomable canvas). The library reads the live transform matrix from `getComputedStyle()` and stores cursor coordinates in the container's local coordinate space, so two clients with different pan/zoom agree on a cursor's content position; each viewer's CSS transform then maps that position to their own viewport pixels. Default behavior is unchanged when `container` is `document.body` (no transform → identity matrix).
