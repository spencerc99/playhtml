---
title: "Dynamic elements"
description: "setupPlayElement for runtime-created nodes, and selector-id for many-of-a-kind elements."
sidebar:
  order: 3
---

`playhtml.init()` walks the DOM once at startup. If you create new playhtml elements after that — a new row in a list, a cloned template, a client-rendered component — you need to tell the library they exist.

- **`playhtml.setupPlayElement(element)`** — register a single node after you've added it to the DOM. Idempotent. Pass `{ ignoreIfAlreadySetup: true }` to skip if the node's already wired.
- **`selector-id`** — apply the same capability to many elements that share a selector. playhtml indexes them by their position in the selector's matches, so the N-th `.fridgeWordHolder` always gets the N-th row of state.

> This page will include the README's dynamic-div example and the `selector-id` pattern from the FridgeWord magnets demo.
