---
"playhtml": patch
"@playhtml/common": patch
---

Route permission-gated writes as explicit operations instead of full snapshots, so concurrent keyed-map creates merge correctly and page-data channels follow the same permission rules as elements.
