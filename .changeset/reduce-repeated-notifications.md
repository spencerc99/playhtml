---
"playhtml": patch
---

Coalesce synchronous primitive page-data notifications and skip user-list updates when only cursor position changes, reducing repeated work for data and presence subscribers.
