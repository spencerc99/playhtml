# CLAUDE.md

This file provides guidance to Claude Code (and other AI agents) when working with code in this repository.

## Project Overview

playhtml is a collaborative, interactive HTML library that allows elements to be magically transformed with simple data attributes. The project consists of multiple packages in a monorepo structure:

- **packages/playhtml**: Core library that adds interactive capabilities to HTML elements
- **packages/react**: React wrapper components for playhtml functionality
- **packages/common**: Shared TypeScript types and interfaces
- **extension/**: Browser extension ("we were online") for collecting and visualizing browsing traces. See `extension/CLAUDE.md` for detailed architecture.
- **extension/website/**: Marketing/landing site for the extension (separate Vite + React app)
- **extension/worker/**: Cloudflare Worker backend for event ingestion (Supabase persistence)
- **partykit/**: Real-time sync server using PartyKit and Yjs for collaborative state
- **website/**: Demo site showcasing playhtml capabilities and the home page for the library. Test pages go here.

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

## Monorepo Structure

Bun workspaces (from root `package.json`):
1. `packages/playhtml`
2. `packages/react`
3. `packages/common`
4. `extension`
5. `extension/website`

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
- **Changesets:** Use `bun run changeset` when user-facing packages change. Config in `.changeset/config.json` (public access, patch for internal deps).
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

### Event Handling

- onClick, onDrag, onDragStart are the main interaction patterns
- Reset shortcuts use modifier keys (shift, ctrl, alt, meta)
- Custom event listeners can be added in `onMount`

## Documentation

- `docs/`: Public developer-facing and user-facing documentation only.
- `internal-docs/`: Internal planning and decision records (gitignored, not committed). Specs go in `internal-docs/specs/`, plans go in `internal-docs/plans/`. Date-prefix files (e.g., `2026-03-13-feature-name.md`).

## Security & Configuration

- Do not commit secrets. `.env` is local only; PartyKit/Supabase keys must remain private.
- Prefer environment variables over literals; never hardcode tokens in code or tests.

## Build Configs

- `vite.config.site.mts`: Multi-page website build (glob-based HTML discovery, outputs to `site-dist/`)
- `packages/*/vite.config.ts`: Library builds with ES format and dts rollup
- `extension/wxt.config.ts`: WXT browser extension build (Chrome + Firefox)
- `partykit/partykit.json`: PartyKit server config
