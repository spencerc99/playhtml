---
"@playhtml/common": patch
"playhtml": patch
---

Keep `can-mirror` scoped to the element that declares it: attributes on that element, its direct child list, and form/contenteditable input state sync, while nested DOM mutations should use their own `can-mirror`. Also rebind locally re-added mirrored capability descendants without duplicate-ID noise.
