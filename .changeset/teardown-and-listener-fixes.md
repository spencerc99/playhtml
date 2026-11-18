---
"playhtml": patch
"@playhtml/common": patch
---

Teardown and listener fixes: `deleteElementData` and `resetPlayHTML()` now fully tear down elements and play event listeners, `element.reset()` restores the default data, `can-mirror` and `can-hover` remove their listeners, `can-grow` shows the not-allowed cursor at its maximum size, and a throwing listener no longer stops the others.
