---
"playhtml": patch
"@playhtml/common": patch
---

Fix several cleanup and listener bugs. `deleteElementData` now tears the element down like `removePlayElement` does: its `onMount` cleanup runs and its view stops re-rendering, instead of continuing to write to the deleted record. `can-mirror` and `can-hover` remove their listeners (and `can-mirror` its MutationObserver) when the element is removed, so a removed mirror no longer keeps syncing and re-adding one no longer stacks observers. `can-grow` now shows the not-allowed cursor once an element reaches its maximum size. `element.reset()` on elements with a reset shortcut now restores the default data instead of doing nothing. A play event listener or page data subscriber that throws is logged and no longer stops the remaining listeners from running. `playhtml.listSharedElements()` now reports `shared="ro"` elements as read-only, matching how they already behave.
