---
title: "Page-level data"
description: "createPageData: named persistent channels that aren't tied to any element."
sidebar:
  order: 2
---

`playhtml.createPageData(name, default)` creates a persistent data channel keyed by a name. No DOM element required. Good for counters, vote tallies, link trackers — anything page-shaped instead of element-shaped.

```js
const counter = playhtml.createPageData("my-counter", { count: 0 });
counter.setData((draft) => { draft.count += 1; });
counter.onUpdate((data) => { /* re-render */ });
```

When you should reach for `createPageData` vs. element data, presence, or events: see the [decision table on data essentials](/docs/data/data-essentials/#when-to-use-which-primitive).

## Navigation

Page data is room-scoped, like element data. On a single-page app, when navigation changes the room the channel resets to the new room — it reads its default until re-seeded. A channel handle you hold across the navigation stays usable (it keeps writing and notifying). Navigation that doesn't change the room leaves the data untouched. See [Navigation & SPAs](/docs/advanced/navigation/).

> This page will include a working inline visit counter built with `createPageData` so you can see the numbers climb in real time.
