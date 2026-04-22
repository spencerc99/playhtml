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

> This page will include a working inline visit counter built with `createPageData` so you can see the numbers climb in real time.
