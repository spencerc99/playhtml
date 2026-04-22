# Future: Docs playground & component gallery

Deferred spec. Not in scope for the current docs-site bring-up; captured here so
the work is not lost. Another track will pick this up.

## (a) Component gallery index

- Source each gallery entry from an MDX file under `src/content/gallery/` (or
  `src/content/docs/gallery/` if we want it inside the sidebar).
- Frontmatter fields: `title`, `tags` (array), `preview` (thumbnail path),
  `slug`, `playhtmlCapabilities` (e.g. `can-move`, `can-toggle`, `shared-data`).
- Build a single index page that auto-collects entries via Astro content
  collections and renders a filterable grid.
- Each entry page embeds a live preview and the source snippet side by side.

## (b) Live playground

- Goal: let a reader click "remix" on any gallery entry and land in an editor
  with that example pre-loaded, live-reloading in a sandboxed iframe.
- Likely built on a Sandpack / WebContainer-style runtime; needs to load
  `playhtml` from the monorepo alias (already wired in `astro.config.mjs`).
- Must support both the vanilla and `@playhtml/react` entry points.
- Persist remixes via a short-lived share URL (query-string encoded snapshot
  first, named rooms later).

## (c) Vanilla-playhtml reactive-view problem

This is the blocker for embedding non-React capabilities in the playground and
for any "render from template" pattern in docs.

- `playhtml` today mutates the live DOM node in place. When a capability wants
  to re-render its view from shared state, the only hook is replacing
  `innerHTML`, which nukes child playhtml elements, event listeners, and any
  imperative state.
- React bindings sidestep this because React owns reconciliation; vanilla
  users cannot opt into that without pulling React.
- Needed: a small reactive-view primitive inside `packages/playhtml` (or
  `packages/common`) that accepts a render function, does keyed diffing so
  nested playhtml nodes survive re-renders, and preserves user-attached
  listeners and capability bindings across updates.
- Until that lands, the playground should restrict vanilla examples to
  capabilities that do not need to re-render markup from state.

## Tracking

- Owner: TBD (separate track, not the docs-site agent).
- Dependencies: content collections schema, sandbox runtime choice, vanilla
  reactive-view design doc.
