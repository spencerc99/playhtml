---
"playhtml": patch
"@playhtml/common": patch
---

Make `playhtml.register(elementOrId, initializer)` the recommended vanilla API for custom elements using either `updateElement` or `view`. Callers can pass an existing HTML element or register by id before the element exists. Registered initializers bind through the standard setup path without being copied onto DOM elements, while direct element-property configuration remains supported for compatibility.
