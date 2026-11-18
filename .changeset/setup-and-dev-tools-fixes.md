---
"playhtml": patch
"@playhtml/common": patch
---

Setup and dev tools fixes: playhtml starts when `localStorage` is blocked, a built-in capability given its own update callback now sets up (which fixes `<CanHoverElement>` in `@playhtml/react`), dev mode cleans up on teardown, and `listSharedElements()` reports `shared="ro"` as read-only.
