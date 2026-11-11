---
"playhtml": patch
"@playhtml/common": patch
---

Several small fixes. `element.reset()` on elements with a reset shortcut now resets the element instead of doing nothing. `can-grow` shows the "not-allowed" cursor once an element reaches its max size. `can-hover` and `can-mirror` remove their listeners (and `can-mirror` its observer) when an element's handler is rebuilt, so listeners no longer pile up and an old observer can't write remote changes back as local edits. Cursor chat shows `<` and `&` as typed instead of as markup. `listSharedElements()` reports `shared="ro"` as read-only, matching the runtime. playhtml no longer throws on startup when `localStorage` is blocked. Dev mode no longer adds a duplicate stylesheet each time it's set up, each element's random `--jiggle-delay` is applied again, and cursor visibility updates are faster on pages with many cursors.
