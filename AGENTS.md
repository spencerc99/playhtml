# Repository Guidelines

## Project Structure & Module Organization

- Root is a Bun + TypeScript monorepo using npm workspaces in `packages/`:
  - `packages/playhtml` (core), `packages/react` (React bindings), `packages/common` (shared types), `packages/extension` (browser extension)
- Site and demos under `website/` (built with Vite); static assets in `website/public/`
- Realtime backend in `partykit/` (PartyKit rooms, admin, utils)
- public docs in `docs/` and internal system design docs in `internal-docs/`; templates in `templates/`

## Build, Test, and Development Commands

- Install: `bun install`
- Site dev: `bun run dev` (uses `vite.config.site.mts`)
- PartyKit dev server: `bun run dev-server`
- Extension dev: `bun run dev-extension` (inside `packages/extension`)
- Build: `bun run build-site`, `bun run build-packages`, `bun run build-extension`
- Type-check/lint: `bun run lint` (TypeScript across workspace)
- Per‑package tests (Vitest):
  - Core: `bun run -C packages/playhtml test`
  - React: `bun run -C packages/react test`
  - Extension: `bun run -C packages/extension test`

## Coding Style & Naming Conventions

- Language: TypeScript (strict mode). Prefer named exports; avoid default unless conventional (`index.ts[x]`).
- Indentation: 2 spaces; max line length ~100.
- Filenames: React components `PascalCase.tsx`; modules/utilities `camelCase.ts`; tests in `__tests__/`.
- Types and components in `PascalCase`; variables/functions in `camelCase`; constants in `SCREAMING_SNAKE_CASE` only when global.
- Run `bunx tsc` (via `bun run lint`) before pushing.

## Testing Guidelines

- Framework: Vitest; DOM adapters: `jsdom` (react) and `happy-dom` (core).
- Place tests under `__tests__/` near sources; name `*.test.ts[x]`.
- Prefer focused unit tests around data updates and DOM effects; avoid network in unit tests.
- Run relevant package tests locally before PRs (see commands above).

## Commit & Pull Request Guidelines

- Commits: short imperative subject; scope paths when helpful (e.g., `react:`). Group mechanical changes separately.
- Versioning/Releases: use Changesets. Add one with `bun run changeset` when user‑facing packages change.
- PRs: include summary, rationale, screenshots for UI/site/extension changes, reproduction for fixes, and link issues. Ensure `bun run lint` and package tests pass.

## Security & Configuration

- Do not commit secrets. `.env` exists for local only; PartyKit/Supabase keys must remain private.
- Prefer environment variables over literals; never hardcode tokens in code or tests.
