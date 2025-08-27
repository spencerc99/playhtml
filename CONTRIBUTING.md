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
