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

> This page will include a working inline visit counter built with `createPageData` so you can see the numbers climb in real time.
