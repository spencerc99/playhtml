# Live editor feature branch plan

Implementation plan for the playhtml live editor / playground. This is a
feature-branch scoped document — companion to the higher-level
`apps/docs/FUTURE_PLAYGROUND.md`, which captures the long-term vision and
outstanding prerequisites. Where the FUTURE doc says "what"/"why" in broad
strokes, this doc says "how"/"when"/"in what order".

Author: TBD. Status: draft. Branch: `feat/live-editor` (TBD).

---

## 1. Context

In the docs site bring-up we built inline runnable demos (React islands for
each capability, a copy-tally on code blocks, presence HUDs, scroll rails).
That covers "here are the capabilities working on a page". What it does NOT
cover is the p5.js-editor move: **"give me a box with code on the left, a
preview on the right, let me edit and instantly see what happens, and let me
share my remix by URL."**

The user's north star reference is the [p5.js web editor](https://editor.p5js.org/):
immediate gratification, low-ceremony remix culture, a canonical artifact
(sketches) that people pass around. playhtml's twist: **every preview iframe
is natively multiplayer** (it's literally a playhtml room), so remixing
something means you can watch your collaborator edit it in real time and
the rendered artifact is itself shared.

Two blockers were flagged earlier as reasons to defer:

- **Content pipeline.** Examples live inline in MDX, not in a data-shaped
  recipe format a playground could load.
- **Vanilla reactive-view problem (see `FUTURE_PLAYGROUND.md` §c).** Vanilla
  playhtml capabilities that want to re-render markup from shared state
  have to nuke and re-insert DOM, which destroys nested playhtml elements.
  React bindings sidestep this because React owns reconciliation.

The feature branch targets everything up to and including a usable MVP
playground; the "remixes have named persistent rooms" and "collaborative
editing of the source itself" work lands in follow-up branches.

---

## 2. Goals and non-goals

### In scope (MVP for this branch)

1. **Recipe format.** A stable on-disk shape for "here is an example",
   consumable by the docs site, the gallery, and the playground.
2. **Gallery page.** Filterable grid of recipes with a static preview,
   source snippet, and a "remix" button.
3. **Live editor route.** A page with CodeMirror on the left and a
   sandboxed preview iframe on the right. Edit code, preview reloads.
   The preview is a real playhtml room.
4. **Shareable URL.** The editor state is URL-encoded so a reader can
   copy the URL and someone else sees the same code.
5. **Vanilla HTML + CSS + JS support.** Enough to cover ~70% of our
   demos (single `<script type="module">`, CDN import of `playhtml`).
6. **Monorepo-aware dev mode.** In `bun run dev` the editor uses the
   locally-aliased `playhtml` (and `@playhtml/react`) from the workspace
   so changes to the library reflect live.

### Out of scope (explicitly punted)

- Bundled React / TypeScript compile in the preview iframe. Requires
  Sandpack / esbuild-wasm; lands in a follow-up branch.
- Multi-file project view (tabs for multiple files, folder tree).
- Arbitrary npm imports. The only dependencies available inside a
  recipe are playhtml + what's in the recipe metadata's `externals`.
- Collaborative cursor/typing in the editor itself (the _iframe_ is
  shared; the source panel is single-user in MVP).
- Named persistent rooms for remixes; MVP encodes everything in the URL.
- Accounts, auth, "my sketches" dashboards.
- Solving the vanilla reactive-view problem — we scope the MVP to
  recipes that don't need it (see §7).

---

## 3. User journeys

### Journey A — "show me the examples"

1. Reader clicks "Examples" in the docs sidebar.
2. Lands on gallery grid: cards with preview, title, capability tags.
3. Filters by `can-toggle` and `shared-state`.
4. Clicks a card. Lands on recipe page: live preview + source + a
   prominent "Remix" button.

### Journey B — "let me try changing this"

1. From a recipe page or from a code block in a doc, reader clicks
   "Remix" (or "Open in playground").
2. Editor page loads with that recipe's files pre-populated.
3. Reader edits. Preview reloads under a small debounce.
4. Reader pastes the URL in Slack / Bluesky / wherever.
5. Collaborator opens the URL, sees the same code, sees the same
   shared preview state.

### Journey C — "start from scratch"

1. Reader visits `/play` with no recipe id.
2. Gets a minimal starter template (an `<h1>` with `can-toggle`).
3. Edits. Shares URL.

### Journey D — "this is cool, I want the library version"

1. Reader, inside a recipe page, clicks "Copy as vanilla" or "Copy as
   React". Gets the code they can paste into their own project.
2. MVP version: just a "Copy source" button that copies the recipe's
   main file. Adapter variants can come later.

---

## 4. Architecture

### 4.1 Recipe format

Each recipe is a folder under `apps/docs/src/content/recipes/<id>/`
with three kinds of files:

```
recipes/
  toggle-basic/
    recipe.md          # frontmatter + narrative body (MDX optional)
    index.html         # vanilla entry (required for MVP)
    component.tsx      # React entry (optional, future)
    preview.png        # static preview (optional; auto-generated fallback)
```

`recipe.md` frontmatter:

```yaml
---
id: toggle-basic
title: Shared on/off toggle
tags: [can-toggle, starter]
capabilities: [can-toggle]
description: >
  A single button that stays in sync across every reader of the URL.
# Optional: external scripts/modules available inside the preview.
externals:
  - name: playhtml
    version: "*"           # resolved to workspace in dev, CDN in prod
entry: index.html          # which file is the iframe's srcdoc
# Static preview — optional; gallery falls back to a live iframe thumb.
preview: preview.png
---

Body copy explaining what this recipe does, linked from the gallery.
```

Recipes are an Astro content collection (`src/content/config.ts`
schema). The gallery index and each recipe page both consume this
collection — a single source of truth.

### 4.2 Runtime: sandboxed iframe with srcdoc

Decision: **start with plain iframe + `srcdoc` + `<script type="importmap">`**
before reaching for Sandpack or WebContainer.

Why:
- Covers all vanilla recipes with zero build tooling in the browser.
- Modern browsers honor import maps inside srcdoc iframes, so
  `import { playhtml } from "playhtml"` resolves to the CDN URL we
  inject at mount.
- Sandpack's minimum bundle is 200KB+ and includes a TS compiler we
  don't need yet. WebContainers are heavier still.
- Upgrading to Sandpack later is additive — we can keep the srcdoc
  path for vanilla recipes and use Sandpack only when a recipe
  declares `entry: component.tsx`.

Iframe HTML (conceptually):

```html
<!doctype html>
<html>
<head>
  <script type="importmap">
    { "imports": { "playhtml": "__PLAYHTML_URL__" } }
  </script>
  <style>__RECIPE_CSS__</style>
</head>
<body>
  __RECIPE_HTML_BODY__
  <script type="module">__RECIPE_SCRIPT__</script>
</body>
</html>
```

`__PLAYHTML_URL__` is `https://unpkg.com/playhtml` in prod. In dev the
editor page serves the workspace build at `/__dev/playhtml.js` via a
tiny Astro endpoint (`src/pages/__dev/playhtml.js.ts`) that re-exports
the workspace package. This is the "monorepo-aware" seam.

Sandbox attributes: `sandbox="allow-scripts allow-popups"` — no
`allow-same-origin` (keeps user code from reaching the editor frame).
Partykit / y-websocket connections still work because WebSocket is
not gated by `allow-same-origin`.

### 4.3 Editor: CodeMirror 6

Decision: **CodeMirror 6** (`@codemirror/state`, `@codemirror/view`,
`@codemirror/lang-html`, `@codemirror/lang-javascript`).

Why:
- ~60KB gzipped for the core; Monaco is ~2MB.
- Ships a good default experience (undo/redo, multi-cursor, selection)
  that matches p5.js editor feel.
- Has an official yjs binding (`y-codemirror.next`) we can slot in
  during the collab phase without rewriting.
- React wrapper available (`@uiw/react-codemirror`) or we can go
  direct if we want to minimize deps.

Extensions to enable:
- `html()` (which brings embedded CSS + JS highlighting via
  `javascript()`).
- Basic theme tuned to the docs' paper-and-ink palette — ships as a
  small CodeMirror theme extension colocated with the editor component.
- Readonly mode for "source" views on gallery pages (reuses the same
  component; just passes `EditorState.readOnly.of(true)`).

### 4.4 URL encoding

MVP: everything in the URL hash.

```
/play#id=toggle-basic&v=1            # unmodified recipe
/play#v=1&c=<lzstring>               # remixed; c = compressed JSON
```

Payload (before compression):

```json
{
  "id": "toggle-basic",
  "entry": "index.html",
  "files": { "index.html": "...", "styles.css": "..." }
}
```

Use [`lz-string`](https://github.com/pieroxy/lz-string) (2KB, battle-tested)
for `compressToEncodedURIComponent`. For a typical 1-2KB source this
produces URL hashes of 200-400 chars — well under the 2000-char
practical ceiling. Anything bigger shows a "this remix is too large
to share via URL — persistent remix coming soon" message until the
follow-up branch adds a server-backed short URL.

The hash (not querystring) keeps the state out of server logs and
stops the Astro router from touching it.

### 4.5 Multiplayer rooms

Three rooms to keep distinct:

| Room                 | Scope                                  | Purpose                                             |
| -------------------- | -------------------------------------- | --------------------------------------------------- |
| docs URL             | per-page on the docs site              | presence HUD, scroll rail, copy tallies             |
| **preview iframe**   | per-recipe-id (or per-remix-hash)      | the playhtml elements INSIDE the preview           |
| editor (future)      | per-remix-hash                         | collaborative source editing — follow-up branch     |

The preview iframe's playhtml room id is set explicitly (override the
default "URL = room" behavior) so every reader of `/play#id=toggle-basic`
hits the same shared preview state regardless of which docs page they
landed on. Remixes get a room id derived from the compressed payload
hash so independent remixes don't collide, but two readers opening the
same remix URL share state.

This is the **single most interesting user-facing property** of the
whole feature and should be preserved end-to-end: copy a URL to a
friend → you are both in the same live sandbox.

### 4.6 Reload strategy

Preview reload on edit, with debounce:
- Debounce: 300ms after last keystroke.
- On reload, replace the iframe element entirely (vs reassigning
  `srcdoc`) so the old playhtml provider tears down cleanly. The new
  iframe re-enters the same room by id, so other readers see a
  brief disconnect + reconnect rather than a full room reset.
- Show a small "reloading…" indicator during the debounce so typing
  doesn't feel like a stuck editor.

Future optimization: Vite-style module-level HMR inside the iframe.
Out of scope for MVP — full reload is the honest p5-editor feel and
avoids a whole class of "stale closure" bugs.

### 4.7 File layout

New files introduced by this branch:

```
apps/docs/
  plans/
    live-editor.md                           # this file
  src/
    content/
      recipes/                               # NEW content collection
        toggle-basic/
          recipe.md
          index.html
        ... (see §6 phasing for which ship in MVP)
      config.ts                              # add `recipes` collection schema
    components/
      playground/                            # NEW
        Editor.tsx                           # CodeMirror wrapper
        Preview.tsx                          # iframe + room wiring
        Playground.tsx                       # side-by-side shell
        recipe-loader.ts                     # hash <-> state, content lookup
        iframe-template.ts                   # srcdoc builder
        theme.ts                             # CodeMirror theme
    pages/
      play.astro                             # /play route
      gallery.astro                          # /gallery route (or under /docs/)
      __dev/
        playhtml.js.ts                       # dev-mode CDN shim
```

Touched (not created):

```
apps/docs/astro.config.mjs                   # add /play, /gallery routes
apps/docs/src/content/config.ts              # recipe collection schema
apps/docs/src/content/docs/capabilities.mdx  # "remix on playground" links
packages/common/src/...                      # IF reactive-view primitive
                                             # blocks a scoped recipe
```

---

## 5. Phasing

Each phase is committable on its own and produces something usable.
The branch may be merged after any of them depending on timing; the
phases are ordered so later ones are additive.

### Phase 1 — Recipe format + gallery (read-only)

**Outcome:** gallery grid exists, shows static cards, each recipe has
its own page with a live iframe preview and a source view. No editing.

Work:
1. Add Astro content collection schema for recipes.
2. Convert 3-4 existing inline demos into recipe folders:
   `toggle-basic`, `move-piece`, `spinner-shared-state`,
   `live-reactions`.
3. Build `Preview.tsx`: takes a recipe id, mounts a sandboxed iframe
   using `iframe-template.ts`. This is the component that also serves
   later playground phases; building it first keeps the gallery live.
4. Build gallery grid page with tag filter (vanilla JS — no need to
   hydrate a full React tree for filter chips).
5. Build recipe detail page: preview + source + copy button.
6. Wire "open in playground" buttons to `/play#id=<id>` (the link
   goes nowhere useful yet — Phase 2).

**Why first:** the recipe format is the contract everything else
depends on. Shipping the gallery off of it first proves the format
works for the consume-side before we build the edit-side.

### Phase 2 — Editor MVP (single-file HTML, URL hash)

**Outcome:** `/play` route loads a recipe, lets you edit, persists
remix in the URL. Readers can remix and share.

Work:
1. CodeMirror wrapper (`Editor.tsx`) with HTML mode, docs theme.
2. Hash read/write (`recipe-loader.ts`): parse `#id=...` or `#c=...`
   on mount, write `#c=...` on edit with lz-string.
3. Debounced iframe reload wired to editor state.
4. Playground shell (`Playground.tsx`): split layout, reset button,
   share button that copies the URL, copy-source button.
5. Dev-mode playhtml shim at `/__dev/playhtml.js`.
6. Empty-state (`/play` with no id): drop in the smallest useful
   recipe as a starter.
7. "Open in playground" links from recipe pages and from
   `can-toggle` / `can-move` / `can-play` docs pages.

**Why second:** the gallery's "remix" button is a dangling link
until this lands; shipping Phase 2 lights it up end-to-end.

### Phase 3 — Recipe coverage + polish

**Outcome:** enough recipes that someone browsing the gallery feels
like they can play with most of the library. Editor UX is properly
tuned.

Work:
1. Port 6-10 more demos into recipes (aim: every `can-*` capability
   has at least one vanilla recipe).
2. Editor polish: keyboard shortcuts (`cmd+s` = share URL,
   `cmd+r` = reload), console panel for runtime errors, "reset to
   original" button after remix.
3. Gallery polish: tag autosuggest, search, "featured" sort.
4. Mobile layout: stacked editor/preview with a toggle.
5. Static preview generation (optional): a Playwright script that
   takes a screenshot of each recipe iframe and writes
   `preview.png` during `bun run build`. Falls back to a live
   iframe thumbnail if no screenshot exists.

### Phase 4 — Follow-up branches (scoped out of this one)

These are tracked here so the Phase 2 design doesn't preclude them,
but they do not land on this branch:

- **React / TS recipes** via Sandpack or esbuild-wasm. Involves
  deciding whether the editor has tabs or stays single-file.
- **Collaborative editor** via `y-codemirror.next`. The editor panel
  becomes a playhtml room itself; cursors and live typing.
- **Named persistent remixes**: a partykit server route that stores
  large payloads and returns a short id (`/play#r=abc123`).
- **Vanilla reactive-view primitive** (see §7) — needed before any
  vanilla recipe that re-renders markup from state.
- **"Publish as gist" / StackBlitz export** — one-click out to a
  canonical host for longer-term sharing.

---

## 6. Recipe selection for MVP

To ground the first milestone, commit to this exact set for Phase 1
and reuse them in Phase 2:

| id                     | capability        | Why it's in the starting set             |
| ---------------------- | ----------------- | ---------------------------------------- |
| `toggle-basic`         | `can-toggle`      | Smallest possible multiplayer demo       |
| `move-piece`           | `can-move`        | Spatial, visually obvious                |
| `spinner-shared`       | shared state      | Textbook `withSharedState` equivalent    |
| `live-reactions`       | events            | Shows one-off events vs persistent state |

All four are vanilla-HTML-friendly; none require the reactive-view
primitive. They span the four main capability buckets so the gallery
feels non-trivial on day one.

---

## 7. The vanilla reactive-view problem (revisited)

This branch deliberately scopes recipes to those that don't need it.
The constraint is: **a recipe's script can attach event listeners and
mutate specific DOM nodes, but it cannot re-render a subtree of HTML
from shared state** without breaking nested playhtml elements.

How we dodge it in MVP recipes:
- `toggle-basic`, `move-piece`: capability handlers do surgical DOM
  updates (attribute changes, transform strings) — no re-render.
- `spinner-shared`: rotates a single element via transform; again,
  surgical.
- `live-reactions`: appends DOM nodes (each reaction is its own new
  element), never re-renders a parent.

Any recipe we want that DOES need reactive re-render — an imperative
todo list, a text input that mirrors to a shared string, a chat log —
is deferred until the primitive lands. The plan doc
`FUTURE_PLAYGROUND.md` §c owns the design-level work for that
primitive; when it lands we unblock a whole new batch of recipes.

---

## 8. Open questions

1. **Gallery URL path.** `/gallery/` vs `/examples/` vs inside the
   Starlight sidebar at `/docs/examples/`? Starlight sidebar gives us
   search indexing + nav cohesion for free; a top-level page feels
   more playground-like. Proposal: `/docs/examples/` for discoverability
   + a sidebar link, with `/play` as the editor top-level.

2. **Recipe storage format.** MDX frontmatter (what this doc proposes)
   vs a dedicated `recipe.json` + separate source files. Frontmatter
   + Astro content collections is nicer DX for authoring (single file
   to edit) but forces source into the markdown body. Leaning toward
   the hybrid: frontmatter metadata in `recipe.md`, source in sibling
   files (`index.html`, `component.tsx`). One path, clear roles.

3. **CodeMirror vs Monaco.** Locked in as CodeMirror 6 in §4.3 but
   worth one more sanity check for anyone who has strong Monaco
   muscle memory — reviewing on the PR is fine.

4. **Copy-source button UX.** Do we emit the exact recipe source, or
   transform it (strip `externals`, inject import, etc.)? Leaning
   "emit exact, let the reader paste into their stack". Revisit
   after we have 2-3 real recipes.

5. **Preview iframe room ids for remixes.** A hash-based id is
   stable but opaque. Do we expose it anywhere? Proposal: show a
   short "room: 4f2a8b" label under the preview so remote
   collaborators can confirm they're in the same iframe session.

6. **Static preview rendering.** Worth building a Playwright
   screenshot pass in Phase 1, or fall back to a live (but cached)
   iframe thumbnail in the grid? Live iframes make the gallery
   feel alive but eat bandwidth at scale. Decision deferred to
   after Phase 1's gallery ships with live iframes; move to
   screenshots only if there's a perf complaint.

---

## 9. Dependencies / prerequisites

Before Phase 1 starts:
- Nothing blocking. The recipe format is additive.

Before Phase 2 starts:
- Phase 1 merged (recipe format exists).
- Pick a `lz-string` version (check bundle impact on `/play` route).
- Decide on the dev-mode playhtml shim endpoint — double-check
  Astro's endpoint capabilities in SSG vs SSR mode.

Before Phase 4's reactive-view work:
- Separate design doc in `packages/common/` or `packages/playhtml/`
  spelling out the keyed-diffing primitive API.
- Probably wants its own branch.

---

## 10. Acceptance criteria for branch merge

The branch may merge once Phase 1 AND Phase 2 satisfy all of:

- [ ] A reader can visit `/docs/examples/` (or equivalent), filter
      by tag, open any recipe, see a live working preview and its
      source.
- [ ] From a recipe, a reader can click "Remix" and land in `/play`
      pre-loaded with that recipe's source.
- [ ] Editing the source debounces a reload; the preview reflects
      the new code within ~500ms of last keystroke.
- [ ] Remixed state survives a page refresh on the same URL.
- [ ] Two readers opening the same remix URL see the same preview
      state sync'd via playhtml.
- [ ] In `bun run dev`, editing the local `packages/playhtml` source
      updates what the iframe runs (hot reload acceptable; full
      refresh acceptable).
- [ ] In `bun run build` → `bun run preview`, the playground loads
      `playhtml` from unpkg and works without the dev shim.
- [ ] No console errors on the gallery or editor pages in Chrome,
      Safari, Firefox (latest).
- [ ] Mobile: a reader on a phone can at minimum _view_ the
      playground (editor/preview may stack, readonly is acceptable).
- [ ] A reader can click "Copy source" and paste into their own
      codebase to reproduce the recipe standalone.

Anything beyond this list is Phase 3 polish or Phase 4 follow-ups.
