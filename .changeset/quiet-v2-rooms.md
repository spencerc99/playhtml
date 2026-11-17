---
"playhtml": minor
"@playhtml/common": minor
---

Add an opt-in version 2 sync path: pass `v2: true` to `playhtml.init`. It covers element data, page data, play events and `deleteElementData`, and reports connection and rejected-write status through `onStatusChange`. Pages that leave it off behave as before and do not download the version 2 code.
