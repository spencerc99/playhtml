---
"@playhtml/extension-types": minor
---

Initial publish: shared event/metadata types for the "we were online" extension and its Cloudflare Worker. Split out from `extension/src/shared/types.ts` so the worker (soon to live in a private repo) can depend on a pinned npm version instead of a relative source path.
