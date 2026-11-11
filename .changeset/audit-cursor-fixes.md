---
"playhtml": patch
---

Fix several cursor rendering issues. With `visibilityThreshold` set on a scrolled page, other people's cursors no longer flicker between shown and hidden, because distance is now always measured in on-screen pixels. A cursor created inside a zone with its own `getCursorStyle` no longer keeps the global `getCursorStyle` styles. Cursor chat now shows typed characters like `<` and `&` as written instead of reading them as HTML. Pointer movement also does less work per frame: the page cursor is only rewritten when it changes, and visibility checks no longer scan every cursor for each cursor.
