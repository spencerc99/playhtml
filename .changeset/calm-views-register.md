---
"playhtml": patch
"@playhtml/common": patch
---

Make `playhtml.register(id, initializer)` the recommended vanilla API for custom elements using either `updateElement` or `view`. Registered initializers now bind through the standard setup path without being copied onto DOM elements, while direct element-property configuration remains supported for compatibility.
