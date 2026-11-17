# playhtml docs

The playhtml documentation site, built with Astro and Starlight. It is served under `/docs/` on [playhtml.fun](https://playhtml.fun/docs/).

Pages live in `src/content/docs/`. Live demos and the playground are React and Astro components in `src/components/`. Because the site's base is `/docs`, asset paths need the `/docs/` prefix (`/docs/foo.png`).

## Commands

Run these from the repository root:

| Command | Action |
| :-- | :-- |
| `bun dev-docs` | Starts the docs dev server at `localhost:4321/docs/` |
| `bun run test:docs` | Runs the docs component and script tests |
| `bun build-site` | Builds the playhtml.fun site and the docs |

The live demos import `playhtml` and `@playhtml/react` from their built output, so run `bun build-packages` first if you changed anything under `packages/`.

Before writing pages, read `claude-plugin/skills/writing-developer-docs/SKILL.md` for the docs style and conventions.
