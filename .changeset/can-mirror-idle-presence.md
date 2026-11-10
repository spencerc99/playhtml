---
"playhtml": patch
"@playhtml/common": patch
---

`can-mirror` elements now share presence only while someone is hovering or focusing them, instead of publishing an idle `{ hover: false, focus: false }` for every element on load. Pages with hundreds of mirrored elements no longer hit the element presence limit, so hover and focus sync on every element again, and the "Element awareness exceeded 8 shards" console error is logged once instead of on every hover.
