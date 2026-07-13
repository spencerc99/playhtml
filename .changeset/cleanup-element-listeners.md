---
"playhtml": patch
---

Clean up built-in element listeners when an element is removed so remounting and dragging do not leave stale handlers active, and install listeners when callbacks are added after setup.
