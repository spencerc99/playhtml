# @playhtml/extension-types

## 0.5.0

### Minor Changes

- c3164bf: Add `element` to `CollectionEventType` and `getValidEventTypes()`. Element events record distinctive page objects seen while browsing (starting with images: URL plus page provenance, with a `kind` discriminant in the payload for future object kinds like buttons) for the extension's internet-scraps collage. They are collected locally by the extension and are not uploaded to the worker.

## 0.4.0

### Minor Changes

- 7db9281: Add `canonicalizeUrl`, `buildPageRef`, and `buildMetadataHash` to the public
  exports. These are the pure helpers both the extension client and the
  Cloudflare Worker use to build stable `page_ref` identifiers — moving them
  into the shared package lets the worker (now in a private repo) consume the
  exact same algorithm via npm instead of reaching into extension source.

## 0.2.0

### Minor Changes

- cf116e4: Initial publish: shared event/metadata types for the "we were online" extension and its Cloudflare Worker. Split out from `extension/src/shared/types.ts` so the worker (soon to live in a private repo) can depend on a pinned npm version instead of a relative source path.
