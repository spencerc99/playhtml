# wewere.online

The website for the "we were online" browser extension: the marketing pages, the changelog, and the visualizations and experiments built from browsing data the extension collects.

## Commands

Run these from `extension/website/`:

- `bun run dev`: start the Vite dev server
- `bun run build`: build every page into `dist/`
- `bun run preview`: serve the built site locally

From the repo root, `bun run build-extension:website` builds the site and `bun run check:extension-website` type-checks it.

## Layout

Each page is an `.html` file in its own folder (`index.html` at the root, `changelog/`, `collage/`, `internet-map/`, and so on). The build picks up every `.html` file automatically.

`shared/` holds the visualization code (components, hooks, sound, and utilities) that both this site and the extension use. Import it through the `@movement` alias, which points at `shared/` here and in the extension's build (`extension/wxt.config.ts`).
