---
"@playhtml/extension-types": minor
---

Add `canonicalizeUrl`, `buildPageRef`, and `buildMetadataHash` to the public
exports. These are the pure helpers both the extension client and the
Cloudflare Worker use to build stable `page_ref` identifiers — moving them
into the shared package lets the worker (now in a private repo) consume the
exact same algorithm via npm instead of reaching into extension source.
