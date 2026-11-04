---
"@playhtml/common": patch
"playhtml": patch
---

Person colors now read back as hex. New identities save their default colors as `#rrggbb` instead of `hsl()`, and `playhtml.people` (`me.color` and each person's `color`), the deprecated `playhtml.users`, `window.cursors.color` and cursor color events convert colors saved as `hsl()` or `rgb()` to hex. You can pass a person's color straight to `<input type="color">`, which only accepts hex. Adds a `toHexColor()` helper to `@playhtml/common`.
