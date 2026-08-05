---
"@playhtml/common": patch
"@playhtml/extension-types": patch
"@playhtml/react": patch
"playhtml": patch
---

Mark the packages as ESM-only instead of advertising CommonJS entry points that could not load their exports. The `playhtml/leafEditor` subpath now provides declarations that type-check with NodeNext module resolution.
