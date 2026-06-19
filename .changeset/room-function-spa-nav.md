---
"playhtml": minor
---

`init`'s `room` option now accepts a function (`() => string`), not just a
string. A function room is re-invoked on every SPA navigation, so a
path-derived room follows the URL the same way the default room does; a static
string still stays fixed for the page's lifetime.
