---
"@playhtml/common": patch
---

Fix a `can-grow` element leaking document-level keydown/keyup listeners when it's removed from the DOM while hovered (e.g. an SPA route change or React unmount that doesn't fire `mouseleave` first). The listeners are now cleaned up on unmount regardless of hover state.
