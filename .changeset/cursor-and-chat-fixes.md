---
"playhtml": patch
---

Cursor and cursor chat fixes: typing in a page's own fields no longer opens cursor chat, chat shows `<` and `&` as typed, cursors no longer flicker on scrolled pages or ignore a zone's own cursor styles, and teardown removes the `window.cursors` it installed and restores the page cursor.
