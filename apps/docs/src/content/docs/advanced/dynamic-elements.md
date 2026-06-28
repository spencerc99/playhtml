---
title: "Dynamic elements"
description: "Register runtime-created nodes with setupPlayElement, and share state across many-of-a-kind elements with selector-id."
sidebar:
  order: 3
---

`playhtml.init()` walks the DOM once at startup and wires up every element it finds. Two situations fall outside that single pass:

1. You **create new playhtml elements after init**: a new row in a list, a cloned template, a client-rendered component. The library doesn't know they exist yet.
2. You have **many elements of the same kind** that can't each get a hand-written unique id but still need their own slot of synced state.

This page covers both.

## Registering nodes created after init

When you add a playhtml element to the DOM yourself, call `setupPlayElement` to register it:

```js
const el = document.createElement("div");
el.id = "note-42";
el.setAttribute("can-move", "");
document.body.appendChild(el);

playhtml.setupPlayElement(el);
```

`setupPlayElement(element, options?)` is **idempotent**. Pass `{ ignoreIfAlreadySetup: true }` to skip elements that are already wired, which is handy when the same code path can run over both fresh and existing nodes:

```js
playhtml.setupPlayElement(el, { ignoreIfAlreadySetup: true });
```

To re-walk the whole DOM (e.g. after injecting a chunk of server-rendered HTML), call `playhtml.setupPlayElements()`, the same pass `init()` runs.

### Cleaning up

When you remove an element from the page, unregister it so its handlers and listeners are torn down:

```js
playhtml.removePlayElement(el);
el.remove();
```

`removePlayElement` only detaches the live handlers. **The element's persisted shared data stays in the room**, so if you re-add an element with the same id it picks up where it left off. To also wipe the saved data, use `deleteElementData(tag, id)`:

```js
playhtml.deleteElementData("can-move", "note-42");
```

See [Development & data cleanup](/docs/advanced/development/) for inspecting and resetting stored state from the devtools panel.

### React

In React you rarely call these directly: mounting a `<CanMoveElement>` (or any capability component) registers the node, and unmounting it calls `removePlayElement` for you. The one place it surfaces is `can-duplicate`, where clones are created imperatively: `CanDuplicateElement` calls `setupPlayElement` on each new clone under the hood. See the [React API reference](/docs/reference/react-api/#other-capability-components).

## Many-of-a-kind elements with `selector-id`

Every playhtml element needs a [stable id](/docs/capabilities/) so collaborators agree on which element owns which state. For a list of structurally identical elements (fridge magnets, reaction buttons, a grid of cells), inventing a unique id for each is tedious and error-prone.

`selector-id` solves this. Give every element in the group the **same** `selector-id` value (a CSS selector that matches all of them), and playhtml assigns each one a stable id based on **its position among the selector's matches**. The 1st `.magnet` always gets the 1st slot of state, the 2nd gets the 2nd, and so on, consistently for every visitor.

```html
<div id="fridge">
  <div can-move selector-id="#fridge .magnet" class="magnet">love</div>
  <div can-move selector-id="#fridge .magnet" class="magnet">to</div>
  <div can-move selector-id="#fridge .magnet" class="magnet">play</div>
</div>
```

All three magnets share the selector `#fridge .magnet`. playhtml indexes them `0, 1, 2`, so each magnet's dragged position syncs and persists independently without you writing a single id.

:::caution[Position is the identity]
Because the id is derived from order-of-appearance, `selector-id` fits **fixed, ordered** groups. If you reorder, insert, or remove items in the middle of the group, the positions shift and elements will adopt each other's stored state. For collections that change shape at runtime, give each item a real stable `id` (e.g. derived from a record id) instead.
:::

### React

Pass `selector-id` straight through to the rendered element. This pattern powers the fridge-magnets demo, where each `FridgeWord` is the same component rendered many times:

```tsx
import { TagType } from "@playhtml/common";
import { withSharedState } from "@playhtml/react";

export const FridgeWord = withSharedState(
  { tagInfo: [TagType.CanMove] },
  (_playProps, props: { word: string }) => (
    <div selector-id="#fridge .fridgeWordHolder" className="fridgeWordHolder">
      <div className="fridgeWord">{props.word}</div>
    </div>
  ),
);
```

Render a `<FridgeWord>` for each word inside `#fridge` and every one gets its own draggable, synced position, with no per-word id required.
