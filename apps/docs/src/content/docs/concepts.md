---
title: "Core concepts"
description: "The four kinds of shared state in playhtml: element data, page data, presence, and events."
sidebar:
  order: 2
---

playhtml gives you four primitives for moving state between readers. Once you can reach for the right one, everything else is just attribute names.

- **Element data** (`defaultData` / [`can-play`](/docs/capabilities/)): persistent state scoped to a single DOM element. A toggle's on/off, a draggable's position, a shared count. Survives reload. See [data essentials](/docs/data/data-essentials/) for shape, updates, and cleanup.
- **Page data** (`playhtml.createPageData`): persistent state keyed by a name, not tied to any element. A page-level counter, a shared prompt, an open vote. See [page-level data](/docs/data/page-data/).
- **Presence** (`playhtml.presence` / cursor awareness): ephemeral per-user state: "who's online", "who's typing", "where's my cursor". Disappears when users disconnect. See [presence](/docs/data/presence/) and [cursors](/docs/data/presence/cursors/).
- **Events** (`playhtml.dispatchPlayEvent`): one-off broadcasts with no persisted state. Confetti, chimes, notifications. See [events](/docs/data/events/).

Not sure which one you want? The [decision table on data essentials](/docs/data/data-essentials/#when-to-use-which-primitive) lays out the tradeoffs side by side.
