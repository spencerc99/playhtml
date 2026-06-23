---
"@playhtml/react": patch
---

`CanHoverElement` now delegates to the built-in `can-hover` capability, so it sets the `[data-playhtml-hover]` attribute on its child while anyone is hovering — matching the vanilla `can-hover` behavior. Previously it toggled a `hovering` class with a separate, divergent implementation.

If you styled the React component's hover effect via `.hovering`, switch your CSS to target `[data-playhtml-hover]` instead. This also brings the component's awareness shape in line with the capability and makes hover sync work consistently with `can-mirror`. `CanHoverElement` additionally now accepts the shared `dataSource`, `shared`, and `standalone` props like the other capability components.

Also drops the now-unused `classnames` runtime dependency.
