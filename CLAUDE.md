# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

playhtml is a collaborative, interactive HTML library that allows elements to be magically transformed with simple data attributes. The project consists of three main packages in a monorepo structure:

- **packages/playhtml**: Core library that adds interactive capabilities to HTML elements
- **packages/react**: React wrapper components for playhtml functionality
- **packages/common**: Shared TypeScript types and interfaces
- **partykit/**: Real-time sync server using PartyKit and Yjs for collaborative state
- **website/**: Demo site showcasing playhtml capabilities and the home page for the library. Any test pages should go in here.

## Development Commands

### Core Development

- `bun dev`: Start the development server for the website
- `bun dev-server`: Start the PartyKit development server for real-time sync
- `bun build-site`: Build the website for production
- `bun build-packages`: Build all packages in the monorepo

### Installing Dependencies

- use bun install to install dependencies for all packages

### Package-Specific Commands

Each package (playhtml, react, common) has its own build process:

- `cd packages/[package-name] && bun build`: Build individual package
- `cd packages/react && bun run test`: Run React package tests

### Testing

- `cd packages/react && bun run test`: Run tests for React components
- `cd packages/react && bun run test:watch`: Run tests in watch mode

## Architecture

### Core Library Structure

The playhtml library revolves around the concept of "capabilities" - interactive behaviors that can be added to HTML elements via data attributes:

1. **Element Capabilities**: Defined in `packages/playhtml/src/elements.ts` and `packages/common/src/index.ts`

   - `can-move`: Draggable elements with 2D translation
   - `can-spin`: Rotatable elements
   - `can-toggle`: Toggle on/off state with CSS classes
   - `can-grow`: Scalable elements with click/alt-click
   - `can-duplicate`: Clone elements dynamically
   - `can-mirror`: Sync all element changes automatically
   - `can-play`: Fully customizable capability framework

2. **State Management**: Uses Yjs for real-time collaborative state sync

   - Global shared state: `globalData` (Y.Map)
   - Element handlers: `elementHandlers` (Map of ElementHandler instances)
   - Awareness (user presence): `yprovider.awareness`

3. **Element Handler System**: Each interactive element gets an `ElementHandler` instance that manages:
   - Data persistence and sync
   - Event handling (click, drag, mount)
   - Element updates and awareness
   - Reset shortcuts and debouncing

### Key Files and Components

- `packages/playhtml/src/index.ts`: Core initialization and setup logic
- `packages/playhtml/src/elements.ts`: ElementHandler class and capability definitions
- `packages/common/src/index.ts`: TypeScript interfaces and types
- `partykit/party.ts`: Real-time server with Supabase persistence
- `packages/react/src/elements.tsx`: React wrapper components

### React Integration

The React package provides declarative components that wrap the core playhtml functionality:

- `<PlayProvider>`: Context provider for playhtml initialization
- `<CanMove>`, `<CanSpin>`, `<CanToggle>` etc.: Component wrappers for each capability
- Custom hooks for accessing playhtml state and events

## Development Workflow

### Adding New Capabilities

1. Define the capability interface in `packages/common/src/index.ts` (data types, TagType enum)
2. Implement the capability in `packages/playhtml/src/elements.ts` (add to TagTypeToElement)
3. Create React wrapper component in `packages/react/src/elements.tsx`
4. Add examples in `website/` directory
5. Follow contributing guidelines in `CONTRIBUTING.md`

### Working with Workspace Packages

Bun automatically handles workspace linking. When making changes across packages, they're immediately available without manual linking. Just run `bun install` at the root to set up workspace dependencies.

### Testing Changes

1. Use the website/ directory to test new capabilities
2. Run the React test suite for regression testing
3. Test real-time sync with multiple browser windows
4. Verify TypeScript compilation across all packages

## Important Patterns

### Element Initialization

- Elements must have unique `id` attributes
- Capabilities are detected via data attributes (e.g., `can-move`, `can-toggle`)
- Custom elements use the `can-play` attribute with JavaScript setup

### State Management

- Use `setData()` for persistent, synced state changes
- Use `setLocalData()` for temporary, local-only state
- Use `setMyAwareness()` for user presence/cursor data
- For React, generally always try to use `withSharedState` rather than the internal `CanPlayElement`

### Event Handling

- onClick, onDrag, onDragStart are the main interaction patterns
- Reset shortcuts use modifier keys (shift, ctrl, alt, meta)
- Custom event listeners can be added in `onMount`

## Project-Specific Notes

- The project uses Bun as the package manager and task runner
- Vite is used for bundling with TypeScript support
- Real-time sync is powered by PartyKit + Yjs with Supabase persistence
- CSS styles are in `packages/playhtml/src/style.scss`
- The website uses a multi-page app (MPA) structure with glob-based HTML discovery
- Workspace dependencies are automatically linked by Bun
- Examples and demos are critical for showcasing capabilities
