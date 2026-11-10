---
"playhtml": patch
"@playhtml/common": patch
---

A `can-mirror` element now leaves the contents of a nested `can-mirror` to that nested element. The outer element no longer re-sends nested changes (typing inside a nested card synced twice before) or puts an outdated copy of the nested contents back for a moment when it updates, which made outer updates on a board of 50 mirrored cards about twice as fast.
