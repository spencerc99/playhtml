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
