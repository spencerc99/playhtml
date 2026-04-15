---
"@playhtml/common": patch
---

Cache `generatePersistentPlayerIdentity()` at the module level so repeated calls return a reference-stable identity. Previously each call re-parsed localStorage, producing a new object with identical data — causing React effect deps and memo comparisons keyed on identity to invalidate on every render. Also fixes two edge cases where corrupt or locked localStorage would cause different identities to be returned across calls in the same session.
