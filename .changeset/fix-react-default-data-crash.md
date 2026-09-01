---
"@playhtml/react": patch
---

Fix function-form `defaultData`/`myDefaultAwareness` (e.g. `(el) => ({ text: el.id })`) being resolved against `null` during the initial render instead of the real element, crashing on mount. It now resolves once the element is attached.
