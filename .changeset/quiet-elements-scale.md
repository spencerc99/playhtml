---
"playhtml": patch
---

Avoid reinitializing bound elements during repeated page scans and limit local awareness updates to the element that changed, reducing navigation and presence overhead on pages with many PlayHTML elements.
