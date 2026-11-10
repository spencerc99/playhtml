# playhtml contribution guidelines

## New Capabilities `can-...`

`playhtml` is designed to be a collective library of magical capabilities that anyone can attach to arbitrary HTML elements.

If you have an idea for a new capability, please first ensure that there is not a duplicate existing one in the current library (see [`TagType`](https://github.com/spencerc99/playhtml/blob/main/src/types.ts#L100)). If it doesn't exist please make a proposal for the capability you would like to add by opening an issue with the `new-capability` label.

To contribute your capability, you are also welcome to make a PR with your addition to `elements.ts` (see [sample PR](https://github.com/spencerc99/playhtml/pull/10/files#diff-37bc0716e9726d7764d49fcc1b08ca0eb3f52170af06f8a49504b47e33ae09d2R327-R383)).

---

Outside of contributing new capabilities, feel free to submit any issues or
PRs for bugs or improvements to the core of the library.

## Contributing to the core library

There is future work I'm planning on getting to in the Issues section. If you have other ideas, please feel free to open an issue to discuss. Would love contributions from the community for any bugs or feature requests :)

### Working with local packages

Bun automatically handles workspace linking, so changes in `common` will be immediately available in `playhtml` and `react` packages without any additional setup. Just run `bun install` at the root to set up the workspace dependencies.

### Updating docs for package changes

When a change under `packages/` affects user-facing behavior, APIs, attributes, CSS classes, examples, or gotchas, update the matching docs under `apps/docs/` in the same PR. Start with the pages most likely to mention the changed surface: capabilities, getting started, React API reference, data, advanced, and integrations docs.

If you checked the docs and no update is needed, call that out in your PR summary so reviewers know it was considered.

### Package API boundaries

`playhtml` is the public runtime and API boundary for app code.

- `@playhtml/react` peers on `playhtml` and imports playhtml domain symbols from `playhtml`, not from `@playhtml/common`.
- `@playhtml/common` is a shared monorepo package owned by `playhtml`. Don't make React consumers install or import it unless a symbol is intentionally promoted as public protocol SDK. If a React-facing symbol lives in `@playhtml/common`, add a curated re-export from `playhtml` rather than `export *`.
- Keep `playhtml` externalized in `packages/react/vite.config.ts` and out of React `dependencies`. Packed declarations must import package names, not monorepo paths like `../../common/src`.

**Tarball install simulation** (required before merging a dependency or export change): version, build, rewrite workspace deps, `npm pack`, install into a blank consumer, check `npm ls`, inspect the React bundle import, and type-check a small consumer file.

### Starter templates

When the public core API changes, update both starters in the same PR and check them live in a browser:

- `templates/react-starter/` (React API: `src/App.tsx`, `src/index.css`). It is Vite + TS with no `tsconfig.json` of its own, so `npm run build`'s `tsc` step picks up the monorepo root config and fails. Verify with `npx vite build` plus a live browser test instead.
- `templates/html-starter/` (vanilla API: `index.html`, `style.css`, `script.js`). Static files loading `playhtml@latest` from unpkg.

The starters depend on the published `playhtml` / `@playhtml/react` (`"latest"`), so they pick up code changes on release, but their own imports, props, selectors, and example markup don't update themselves. Use only real API methods: there is no `playhtml.setupCustomElement`. Vanilla custom elements set `defaultData` / `onClick` / `updateElement` on the DOM element, then call `playhtml.setupPlayElement(el)`.

## Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for managing package versions and releases.

### Creating a Changeset

When you make changes that should be included in a release, you need to create a changeset:

```bash
bun run changeset
```

This will prompt you to:
1. Select which packages are affected by your changes
2. Choose the type of version bump (patch, minor, major)
3. Provide a summary of your changes

### Automated Releases

Once your changes are merged to `main`, the GitHub Action workflow will:

1. **Create a Release PR**: If there are pending changesets, it will create a "Release" PR that updates package versions and generates changelogs
2. **Publish to NPM**: When the Release PR is merged, it will automatically publish the updated packages to NPM

### Manual Release Commands (Deprecated)

The following manual release commands have been removed and replaced with the changesets workflow:

- ~~`bun run release:*`~~ - Use changesets instead  
- ~~`node scripts/release.js`~~ - Removed, use changesets workflow
