---
"@playhtml/react": patch
---

`@playhtml/react` no longer bundles the `playhtml` core into its dist. `playhtml`, `@playhtml/common`, and `classnames` are now externalized and resolved at the consumer's build time (`playhtml` is already a `peerDependency`). This shrinks the published bundle from ~409 KB to ~19 KB and keeps the core's runtime deps — including yjs, syncedstore, and lit-html — out of the React package entirely. The new vanilla `view` API ships lit-html in the `playhtml` core for HTML users by default, but it is never pulled into `@playhtml/react`.
