---
title: "Core concepts"
description: "The four kinds of shared state in playhtml: element data, page data, presence, and events."
sidebar:
  order: 2
---

playhtml gives a page four kinds of shared state. Some stay attached to a specific element, some belong to the page as a whole; some are saved forever, some are live only while people are here. Everyone visiting the same url shares one room, so whichever kind you reach for, it shows up for everyone else too.

![A page running playhtml with four kinds of shared state called out: element data bound to a specific element, page data read by name anywhere on the page, live presence cursors, and one-off events. Element and page data persist; presence and events are ephemeral. Faded pages behind show that everyone on the same url shares one room.](/docs/how-playhtml-works-overview.png)

Once you can reach for the right one, everything else is just attribute names.

- **Element data** (`defaultData` / [`can-play`](/docs/capabilities/)): persistent state scoped to a single DOM element. A toggle's on/off, a draggable's position, a shared count. Survives reload. See [data essentials](/docs/data/data-essentials/) for shape, updates, and cleanup.
- **Page data** (`playhtml.createPageData`): persistent state keyed by a name, not tied to any element. A page-level counter, a shared prompt, an open vote. See [page-level data](/docs/data/page-data/).
- **Presence** (`playhtml.presence` / cursor awareness): ephemeral per-user state: "who's online", "who's typing", "where's my cursor". Disappears when users disconnect. See [presence](/docs/data/presence/) and [cursors](/docs/data/presence/cursors/).
- **Events** (`playhtml.dispatchPlayEvent`): one-off broadcasts with no persisted state. Confetti, chimes, notifications. See [events](/docs/data/events/).

Not sure which one you want? The [decision table on data essentials](/docs/data/data-essentials/#when-to-use-which-primitive) lays out the tradeoffs side by side.
