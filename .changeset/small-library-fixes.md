---
"playhtml": patch
---

In `developmentMode`, playhtml now warns once for each element that has no `id` or `selector-id`. Those elements get an id from a hash of their HTML, so any change to their markup loses their saved data, and the warning names the element so you can add an `id`. playhtml also does less work per update: reading shared element and page data no longer throws and catches an error internally on every remote change, and each cursor frame now checks only the people it came from for expired presence, leaving everyone else to the once-a-second check.
