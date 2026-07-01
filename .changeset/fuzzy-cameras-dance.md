---
"playhtml": patch
---

Fix repeated PlayHTML element setup with `ignoreIfAlreadySetup` so React-bound elements keep their existing handlers during rerenders instead of reinitializing.
