# CLAUDE.md

This file provides guidance to Claude Code (and other AI agents) when working with code in this repository.

## Project Overview

playhtml is a collaborative, interactive HTML library that allows elements to be magically transformed with simple data attributes. The project consists of multiple packages in a monorepo structure:

- **packages/playhtml**: Core library that adds interactive capabilities to HTML elements
- **packages/react**: React wrapper components for playhtml functionality
- **packages/common**: Shared TypeScript types and interfaces
- **packages/extension-types**: Shared event/metadata type contract between the extension and its Cloudflare Worker (`@playhtml/extension-types`)
- **extension/**: Browser extension ("we were online") for collecting and visualizing browsing traces. See `extension/CLAUDE.md` for detailed architecture.
- **extension/website/**: `wewere.online` site — marketing pages (home, privacy) plus visualization experiments (`portrait/`, `rabbithole/`, `conversations/`, `keypresses/`, `sounds/`, `components-preview/`). Shared visualization code lives in `extension/website/shared/` and is reached via the `@movement` path alias. Homepage uses `<DownloadGate />` (`src/components/DownloadGate.tsx`) which shows install buttons directly on desktop and an email-signup form on mobile (mobile detected via `(hover: none) and (pointer: coarse)` media query). The form POSTs to the worker's `/subscribe` endpoint which adds the contact to Resend and sends a welcome email with install links.
- **extension/worker/**: Cloudflare Worker backend for event ingestion (Supabase persistence)
- **partykit/**: Real-time sync server using PartyKit and Yjs for collaborative state
- **website/**: Demo site for playhtml capabilities and the library's home page (`playhtml.fun`). Test pages go here.
- **apps/docs/**: Astro + Starlight documentation site (served under `/docs/` in the combined production build).

## Development Commands

### Core Development

- `bun dev`: Start the website dev server (Vite)
- `bun dev-server`: Start the PartyKit dev server for real-time sync
- `bun dev-extension`: Start extension dev server (WXT hot reload)
- `bun build-site`: Build the website for production
- `bun build-packages`: Build all library packages
- `bun build-extension`: Build extension for Chrome

### Installing Dependencies

- `bun install` at the root to install dependencies for all workspaces

### Per-Package Commands

- `bun run -C packages/playhtml build`: Build core library
- `bun run -C packages/react build`: Build React bindings
- `bun run -C packages/common build`: Build shared types

### Testing

- `bun run -C packages/playhtml test`: Run core library tests (Vitest + jsdom)
- `bun run -C packages/react test`: Run React component tests (Vitest + jsdom)
- `bun run -C extension test`: Run extension collector/storage tests (Vitest + jsdom)
- `bun run lint`: Type-check all packages (`bunx tsc` across workspace)

### Deployment

- `bun deploy-server`: Deploy PartyKit to production
- `bun deploy-server:staging`: Deploy PartyKit to staging

## Architecture

### Core Library (packages/playhtml)

The library revolves around "capabilities" -- interactive behaviors added to HTML elements via data attributes:

1. **Element Capabilities** (defined in `packages/playhtml/src/elements.ts` and `packages/common/src/index.ts`):

   - `can-move`: Draggable elements with 2D translation
   - `can-spin`: Rotatable elements
   - `can-toggle`: Toggle on/off state with CSS classes
   - `can-grow`: Scalable elements with click/alt-click
   - `can-duplicate`: Clone elements dynamically
   - `can-mirror`: Sync all element changes automatically
   - `can-play`: Fully customizable capability framework

2. **State Management**: Yjs for real-time collaborative state sync

   - Global shared state: `globalData` (Y.Map)
   - Element handlers: `elementHandlers` (Map of ElementHandler instances)
   - Awareness (user presence): `yprovider.awareness`

3. **Element Handler System**: Each interactive element gets an `ElementHandler` instance managing data persistence, event handling, element updates, awareness, reset shortcuts, and debouncing.

### Key Files

- `packages/playhtml/src/index.ts`: Core initialization and setup
- `packages/playhtml/src/elements.ts`: ElementHandler class and capability definitions
- `packages/playhtml/src/presence.ts`: User presence tracking
- `packages/playhtml/src/page-data.ts`: Page data management
- `packages/common/src/index.ts`: TypeScript interfaces and types
- `packages/common/src/cursor-types.ts`: Cursor type definitions
- `partykit/party.ts`: Real-time server with Supabase persistence
- `packages/react/src/elements.tsx`: React wrapper components

### React Integration (packages/react)

- `<PlayProvider>`: Context provider for playhtml initialization
- `<CanMove>`, `<CanSpin>`, `<CanToggle>`, etc.: Component wrappers for each capability
- Custom hooks for accessing playhtml state and events
- Prefer `withSharedState` over internal `CanPlayElement` for React usage

### Real-Time Backend (partykit/)

- `party.ts`: Main PartyKit room implementation (Yjs doc sync, Supabase persistence)
- `admin.ts`: Admin utilities
- `db.ts`: Database connection layer

### Docs Site (apps/docs/)

Astro + Starlight site at `apps/docs/`, served under `/docs/` in production via Astro's `base: "/docs"` config.

**Sidebar is hybrid** (manual top + autogenerated subdirs). See `apps/docs/astro.config.mjs` for the full layout with comments.

- **Top groups** ("Start", "Capabilities") are hand-rolled because there's no matching directory on disk
- **Subdir groups** ("Data", "Advanced", "Integrations", "Reference") are autogenerated from their on-disk directories
- **Adding a new page in a subdir:** just set `sidebar: { order: N }` in the page frontmatter; it shows up in the sidebar automatically
- **Adding a new top-level page:** add an entry to the hand-rolled section in `astro.config.mjs` AND a `sidebar.order` in the page frontmatter

**Asset paths:** because of `base: "/docs"`, asset URLs in CSS and JS-generated styles need to include the `/docs/` prefix. Use `/docs/foo.png` rather than `/foo.png` in `url()` declarations and `src` attributes. Files live in `apps/docs/public/` but are served under `/docs/`.

**Init pattern:** the docs site initializes playhtml globally in `HeadOverride.astro`, NOT via `<PlayProvider>`. React islands that need playhtml use `standalone` mode on `CanPlayElement` / `CanToggleElement` etc., which is a no-op when playhtml is already initialized but lets the component register itself with the right handlers.

## Monorepo Structure

Bun workspaces (from root `package.json`):

1. `packages/playhtml`
2. `packages/react`
3. `packages/common`
4. `packages/extension-types`
5. `extension`
6. `extension/website`
7. `extension/worker`

Bun handles workspace linking automatically. Changes across packages are immediately available without manual linking. Run `bun install` at the root to set up workspace dependencies.

**Note:** `packages/extension/` is a WXT build artifact directory, not a real package. The extension workspace lives at `extension/`.

## Coding Style & Naming

- **Language:** TypeScript (strict mode). Prefer named exports; avoid default unless conventional.
- **Indentation:** 2 spaces; max line length ~100.
- **Filenames:** React components `PascalCase.tsx`; modules/utilities `camelCase.ts`; tests in `__tests__/`.
- **Types and components:** `PascalCase`; variables/functions: `camelCase`; constants: `SCREAMING_SNAKE_CASE` only when global.
- **Vite** for bundling with TypeScript support and `vite-plugin-dts` for type generation.

## Testing

- **Framework:** Vitest across all packages
- **DOM adapters:** jsdom (react, extension) and happy-dom (core where needed)
- **Test location:** `__tests__/` directories near source; files named `*.test.ts[x]`
- **Core tests (12 files):** element handlers, awareness, cursors, presence, page data, spatial grid, performance
- **React tests:** PlayProvider integration
- **Extension tests:** Collector unit tests, integration tests
- Run relevant package tests locally before PRs

## Commit & PR Guidelines

- **Commits:** Short imperative subject; scope paths when helpful (e.g., `react:`, `extension:`). Group mechanical changes separately.
- **Changesets:** ALWAYS add a changeset whenever you modify code under `packages/` (core libraries: `playhtml`, `@playhtml/react`, `@playhtml/common`). Create the file directly in `.changeset/<short-slug>.md` with the standard frontmatter (`"<package>": patch|minor|major`) and a one-paragraph user-facing description of the change and why. `bun run changeset` is the interactive equivalent. Config in `.changeset/config.json` (public access, patch for internal deps). Skip changesets only for changes outside `packages/` (website, extension, docs, internal-docs).
- **Docs audit for package changes:** Whenever you change code under `packages/`, check whether public documentation in `apps/docs/` needs to change. Update the relevant user-facing docs in the same PR when behavior, APIs, attributes, classes, examples, or gotchas change. Common places to check are `apps/docs/src/content/docs/capabilities.mdx`, `apps/docs/src/content/docs/getting-started.mdx`, `apps/docs/src/content/docs/reference/react-api.md`, and the `data/`, `advanced/`, and `integrations/` docs. If no docs change is needed, mention why in the PR summary.
- **Releases:** `bun run version-packages` then `bun run release` (builds + publishes via changesets).
- **PRs:** Include summary, rationale, screenshots for UI/site/extension changes, reproduction for fixes, and link issues.

## Important Patterns

### Element Initialization

- Elements must have unique `id` attributes
- Capabilities detected via data attributes (e.g., `can-move`, `can-toggle`)
- Custom elements use the `can-play` attribute with JavaScript setup

### State Management

- `setData()` for persistent, synced state changes
- `setLocalData()` for temporary, local-only state
- `setMyAwareness()` for user presence/cursor data
- **NEVER write shared data (`setData`) from a callback that re-runs when that data changes** (e.g. a React `useEffect` depending on `data.x` that also calls `setData`, or `setData` inside `updateElement`). It loops forever, and because the data is a CRDT, concurrent writes append instead of overwrite — so it never converges. This crashed a production room (1.2M ops / 23 MB). Write from explicit user events; if you must write from a reactive callback, read the data through a ref (don't depend on it) and make the write idempotent (key by unique id, last-write-wins). Full guidance: the `building-playhtml-elements` skill in `claude-plugin/skills/` and https://playhtml.fun/docs/data/data-essentials/ (rule 7).
- **When changing the SHAPE of persisted shared data for something already live, you MUST migrate or clear the old data — and flag this to Spencer.** `defaultData` only seeds brand-new elements; rooms that already have persisted data load it as-is, so a shape change (array→map, renamed field, new required field) means existing rooms hydrate the OLD shape into NEW code. That mismatch crashes the page (e.g. a keyed write `data.entries[pid]=…` against a room whose `entries` is still a legacy Y.Array throws and blanks the page). Options, in order of preference: (1) write to a NEW field name and abandon the old one (no migration, always-clean writes); (2) defensively handle both shapes at read AND write (null-safe reads, initialize-if-absent, in-place migrate — fragile, test against real legacy data); (3) clear the room's persisted data (delete the `documents` row). This ONLY applies when the data is already live/persisted — brand-new features have no old data to worry about. Note: our load/soak tests do NOT catch this — they bypass page code and start from empty rooms, so a data-shape change must be verified by loading the real page against a room pre-seeded with the old shape.

When building or modifying playhtml elements, follow the `building-playhtml-elements` skill in `claude-plugin/skills/building-playhtml-elements/SKILL.md` — it captures the full set of footguns (config-before-init, missing ids, write loops, array-mutation rules).

### Event Handling

- onClick, onDrag, onDragStart are the main interaction patterns
- Reset shortcuts use modifier keys (shift, ctrl, alt, meta)
- Custom event listeners can be added in `onMount`

## Documentation

- `apps/docs/`: Public developer-facing and user-facing documentation. All user-visible docs live here as Astro + Starlight pages. DO NOT PUT PLANS IN HERE.
- Package behavior changes should be reflected in `apps/docs/` when they affect how users write HTML, React components, CSS, shared data, setup code, or troubleshooting steps.
- `internal-docs/`: Internal planning and decision records (gitignored, not committed). Specs go in `internal-docs/specs/`, plans go in `internal-docs/plans/`. Date-prefix files (e.g., `2026-03-13-feature-name.md`).

## Security & Configuration

- Do not commit secrets. `.env` is local only; PartyKit/Supabase keys must remain private.
- Prefer environment variables over literals; never hardcode tokens in code or tests.

## Build Configs

- `vite.config.site.mts`: Multi-page website build (glob-based HTML discovery, outputs to `site-dist/`)
- `packages/*/vite.config.ts`: Library builds with ES format and dts rollup
- `extension/wxt.config.ts`: WXT browser extension build (Chrome + Firefox)
- `partykit/partykit.json`: PartyKit server config
