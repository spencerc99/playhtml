# <a href="https://playhtml.fun">playhtml</a> 🛝🌐 [![npm release](https://img.shields.io/npm/v/playhtml?color=%23ff980c)](https://www.npmjs.com/package/playhtml) [![Downloads](https://img.shields.io/npm/dm/playhtml)](https://www.npmjs.com/package/playhtml) [![Size](https://img.shields.io/bundlephobia/min/playhtml?color=%23c6e1ea)](https://www.npmjs.com/package/playhtml)

_interactive, collaborative HTML elements with a single data attribute_

playhtml is a fast, small (~300KB), library-agnostic, and expressive library for magically creating collaborative interactive HTML elements that persist their state across sessions. It aims to be infrastructure for creating lived-in, alive internet spaces filled with traces of past visitors and the life of present visitors.

```html
<div id="couch" can-move style="font-size: 80px">🛋</div>
```

That's it. The couch is draggable for everyone on the page, and its position persists across sessions.

https://github.com/spencerc99/playhtml/assets/14796580/00e84e15-2c1c-4b4b-8e15-2af22f39db7a

**📚 [Full documentation →](https://playhtml.fun/docs/)**

playhtml is in beta and actively developed. Join the [Discord](https://discord.com/invite/SKbsSf4ptU) to get help and show what you've built.

## 30-second install

**Vanilla HTML** — drop in from a CDN, no build step:

```html
<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml";
  playhtml.init();
</script>
<img can-toggle id="lamp" src="lamp.png" />
```

**React:**

```bash
npm install @playhtml/react @playhtml/common
```

```tsx
import { PlayProvider, CanToggleElement } from "@playhtml/react";

<PlayProvider>
  <CanToggleElement>
    <img id="lamp" src="lamp.png" />
  </CanToggleElement>
</PlayProvider>;
```

See [getting started](https://playhtml.fun/docs/getting-started/) for both paths in depth. React users should also read the [React API reference](https://playhtml.fun/docs/reference/react-api/).

## What's in the box

**Built-in capabilities** — drop these attributes on any element:

| Attribute       | What it does                                                  |
| --------------- | ------------------------------------------------------------- |
| `can-move`      | Drag anywhere; position persists and syncs                    |
| `can-toggle`    | Click to flip an on/off state                                 |
| `can-spin`      | Rotate by dragging                                            |
| `can-grow`      | Click to scale up, alt-click to scale down                    |
| `can-duplicate` | Click to clone a target element                               |
| `can-mirror`    | Auto-sync attributes, children, and form state (experimental) |
| `can-hover`     | Sync hover state across users                                 |
| `can-play`      | Fully custom capability with your own logic                   |

Each has a live demo and full docs in the [capabilities reference](https://playhtml.fun/docs/capabilities/).

**Beyond capabilities:**

- **[Element data](https://playhtml.fun/docs/data/data-essentials/)** — persistent, synced state scoped to a single element
- **[Page-level data](https://playhtml.fun/docs/data/page-data/)** — shared data channels not tied to DOM elements (counters, votes, etc.)
- **[Presence & cursors](https://playhtml.fun/docs/data/presence/)** — ephemeral per-user state with custom channels, plus multiplayer cursors
- **[Events](https://playhtml.fun/docs/data/events/)** — fire-and-forget broadcasts for transient actions (confetti, pings)
- **[Shared elements](https://playhtml.fun/docs/advanced/shared-elements/)** — cross-page and cross-domain state for interconnected sites
- **[Dynamic elements](https://playhtml.fun/docs/advanced/dynamic-elements/)** — `setupPlayElement` and `selector-id` for runtime-added nodes
- **[SPA navigation](https://playhtml.fun/docs/advanced/navigation/)** — works with Astro ViewTransitions, React Router, Next.js, htmx boost, Turbo

## Building with AI

playhtml works well with coding assistants.

**Claude Code users** — install the plugin for a skill that auto-activates when you ask Claude to build playhtml elements:

```bash
claude plugin marketplace add spencerc99/playhtml
claude plugin install playhtml@playhtml
```

**Any other LLM (ChatGPT, Copilot, Cursor, ...)** — copy the prompt template from the [building with AI](https://playhtml.fun/docs/integrations/building-with-ai/) guide into your conversation.

## Examples

- Live demos at [playhtml.fun](https://playhtml.fun) and [playhtml.fun/experiments/](https://playhtml.fun/experiments/)
- Source examples in `website/` and `packages/react/examples/`
- Capability demos (interactive, running side-by-side with the code) on every [capabilities page](https://playhtml.fun/docs/capabilities/)

## Help & Community

- **Docs:** [playhtml.fun/docs](https://playhtml.fun/docs/)
- **Discord:** [discord.gg/SKbsSf4ptU](https://discord.gg/SKbsSf4ptU)
- **Email:** [hi@spencer.place](mailto:hi@spencer.place)

## Data policy

All data is currently stored by a [PartyKit](https://partykit.dev) instance under my account and is not encrypted. Anyone with the room name can access the data. Custom persistence options (your own storage backend) are on the roadmap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions for new built-in capabilities are especially welcome — the same `can-play` API powers all of them.

## Support & Maintenance

If you enjoy using this, please consider [sponsoring the project](https://github.com/sponsors/spencerc99). This helps fund the hosting costs for the syncing and persistence services and keeps the library maintained over time.

## Licensing

This repository uses two licenses:

- **MIT** — applies to `packages/` (the playhtml library, React bindings, shared types, extension-types package). See [`LICENSE`](LICENSE).
- **CC BY-NC-ND 4.0** — applies to everything else (`website/`, `extension/`, `tools/`, `apps/docs/`), which contain Spencer's personal art, product copy, visualizations, and exhibition work. See [`LICENSE-ART`](LICENSE-ART).

The library is free to use, modify, and embed commercially. The art, experiments, and extension UI are visible as receipts of authorship but may not be copied commercially or redistributed as derivatives.
