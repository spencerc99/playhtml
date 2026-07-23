---
title: "Capabilities reference"
description: "Every built-in can-* attribute: data shape, companion attributes, CSS hooks, defaults, and reset behavior."
sidebar:
  order: 2
---

Capabilities are HTML attributes. Add one to an element, give it a stable unique `id`, call `playhtml.init()`, and playhtml handles sync and event wiring.

The `id` is the storage key — it must match across visitors. Use a hand-written `id="my-lamp"`. Without one, playhtml falls back to an HTML hash that can differ across browsers and break sync. For many same-template elements, use `selector-id` instead — see [Dynamic elements](/docs/advanced/dynamic-elements/).

For demos, see the [Capabilities guide](/docs/capabilities/). For React wrappers, see [React API](/docs/reference/react-api/).

---

## Summary table

| Attribute | What it does | Shared data shape | Persistent | Reset shortcut |
|---|---|---|---|---|
| `can-move` | Drag to reposition | `{ x, y }` (numbers) | Yes | Shift-click |
| `can-spin` | Drag to rotate | `{ rotation }` (degrees) | Yes | Shift-click |
| `can-toggle` | Click to flip on/off | `{ on: boolean }` | Yes | Shift-click |
| `can-grow` | Click to scale up/down | `{ scale }` (multiplier) | Yes | Shift-click |
| `can-duplicate` | Click to clone a template element | `string[]` of clone ids | Yes | — |
| `can-hover` | Surfaces hover state from any visitor | none (presence only) | No | — |
| `can-mirror` | Syncs attributes, child list, and form state | element state snapshot | Yes | — |
| `can-play` | Build your own capability | you define it | you define it | optional |

---

## `can-move`

Makes an element draggable. Position persists and syncs — everyone sees the same position.

**Guide page:** [can-move](/docs/capabilities/#can-move)

### Data

**Type:** `{ x: number; y: number }`  
**Default:** `{ x: 0, y: 0 }`

Both values are rounded to one decimal place before being written to shared state (`Math.round(n * 10) / 10`), keeping synced values compact over the wire.

### DOM effect

Sets `element.style.transform = "translate(Xpx, Ypx)"` on every update.

:::caution[Transform conflict]
`can-move`, `can-spin`, and `can-grow` all write `element.style.transform`. On one element, the last update wins. Use `can-play` if you need a combined transform.
:::

### Default containment (no bounds)

Without `can-move-bounds`, the element is constrained to the **viewport**: if the element is already partially outside the viewport edge, dragging further in that direction is blocked. The element can still be moved freely along axes where it is within the viewport.

### Companion attributes

#### `can-move-bounds`

**Type:** element reference (bare id, `#id`, or CSS selector)  
**Default:** none

Constrains the drag area to the referenced container. Accepts three forms:

```html
can-move-bounds="my-arena"      <!-- bare id -->
can-move-bounds="#my-arena"     <!-- id with # prefix -->
can-move-bounds=".arenas"       <!-- CSS selector — first match wins -->
```

An id lookup is tried first; if that fails, the value is used as a CSS selector.

While dragging, the cursor can move past the edge; only the element's position is clamped.
Setup leaves the element's initial CSS layout and persisted position unchanged.

#### `can-move-bounds-min-visible`

**Type:** number (fraction, 0–1)  
**Default:** `1`

The fraction of the element that must remain inside the bounds container on each axis. `1` (the default) keeps the entire element inside. Lower values allow partial overhang.

```html
<!-- Let the element hang up to halfway outside -->
<div can-move can-move-bounds="arena"
     can-move-bounds-min-visible="0.5"
     id="sticker">🧲</div>
```

Set to `0` to drop the fraction constraint entirely (the pixel floor still applies unless you also zero that out).

#### `can-move-bounds-min-visible-px`

**Type:** number (pixels, ≥ 0)  
**Default:** `60`

Pixel floor on the keep-visible slice when partial overhang is allowed. Stops the element from sliding fully out of reach.

**Effective slice on each axis:**

```
max(minVisible × elementSize, minVisiblePx)
```

...capped at the full element size. A 100 px element with `min-visible="0.3"` and `min-visible-px="60"` yields a 60 px slice (the fraction gives 30, the floor gives 60, so the floor wins).

**To allow fully off-screen movement,** set both to `0`:

```html
<div can-move can-move-bounds="arena"
     can-move-bounds-min-visible="0"
     can-move-bounds-min-visible-px="0"
     id="ghost">👻</div>
```

### Reset

**Shortcut:** shift-click  
Resets position to `{ x: 0, y: 0 }` for all visitors in the room.

---

## `can-spin`

Makes an element rotatable by dragging horizontally. Rotation persists and syncs.

**Guide page:** [can-spin](/docs/capabilities/#can-spin)

### Data

**Type:** `{ rotation: number }`  
**Default:** `{ rotation: 0 }`

`rotation` is in degrees. Positive values are clockwise.

### DOM effect

Sets `element.style.transform = "rotate(Ndeg)"` on every update. See the transform conflict note under `can-move`.

### Interaction

Drag the element horizontally. Dragging right increases rotation; dragging left decreases it. The rotation increment scales with the absolute horizontal distance moved (multiplied by 2).

### Reset

**Shortcut:** shift-click  
Resets rotation to `0` for all visitors in the room.

---

## `can-toggle`

Turns click into a shared boolean switch. State persists and syncs.

**Guide page:** [can-toggle](/docs/capabilities/#can-toggle)

### Data

**Type:** `{ on: boolean }`  
**Default:** `{ on: false }`

### DOM effect

Toggles the `toggled` CSS class on the element.

```css
/* Style the on state */
#my-lamp.toggled {
  opacity: 1;
  filter: brightness(1.4);
}
```

### Interaction

Click the element to flip `on` between `true` and `false`.

### Reset

**Shortcut:** shift-click  
Resets to `{ on: false }` for all visitors in the room.

---

## `can-grow`

Click to scale an element up; alt-click to scale it down. Scale persists and syncs.

**Guide page:** [can-grow](/docs/capabilities/#can-grow)

### Data

**Type:** `{ scale: number }`  
**Default:** `{ scale: 1 }`

`scale` is a CSS scale multiplier (`1` = natural size, `2` = double, `0.5` = half).

The maximum scale (`2` by default) and hover tracking are kept in local (non-synced) state and are not persisted. All visitors share the same `scale` value, but each client holds its own `maxScale` cap of `2`.

### DOM effect

Sets `element.style.transform = "scale(N)"` on every update. See the transform conflict note under `can-move`.

### Interaction

| Action | Effect | Limit |
|---|---|---|
| Click | `scale += 0.1` | Capped at `maxScale` (default 2) |
| Alt-click | `scale -= 0.1` | Floored at `0.5` |

When hovering over the element, the cursor changes to indicate the available action:

- **Grow available:** shower / spray cursor 🚿
- **Shrink available (alt held):** scissors cursor ✂️
- **At maximum:** `not-allowed`
- **At minimum (alt held):** `not-allowed`

The cursor also updates dynamically as you hold or release the alt key while hovering.

### Reset

**Shortcut:** shift-click  
Resets to `{ scale: 1 }` for all visitors in the room.

---

## `can-duplicate`

Clicking the element clones a template into a new persistent element. All clones are shared state — everyone sees the same set of clones.

**Guide page:** [can-duplicate](/docs/capabilities/#can-duplicate)

### Attribute value

The attribute value names the **template element** to clone. It accepts the same three forms as `can-move-bounds`:

```html
<img id="bunny-template" src="/bunny.png" alt="" />
<button can-duplicate="bunny-template" id="clone-btn">add bunny</button>
```

An id lookup is tried first; if that fails the value is used as a CSS selector.

### Data

**Type:** `string[]` — array of clone ids  
**Default:** `[]`

Each clone id is generated as `<templateId>-<random>` where `templateId` is the template element's actual `.id` property (not the raw attribute string). This means `#my-template` and `my-template` both yield ids prefixed `my-template-`.

### Interaction

Clicking the element appends a new clone id to the shared array. All clients react to the change, clone the template node, inject it into the page, and call `playhtml.setupPlayElement()` on the clone so it becomes a live playhtml element with its own shared state.

### Companion attribute: `can-duplicate-to`

**Type:** element reference (bare id, `#id`, or CSS selector)  
**Default:** none

When set, every clone is appended to this container element instead of being inserted after the template (or the previous clone).

```html
<div id="bunny-pen"></div>
<button can-duplicate="bunny-template"
        can-duplicate-to="#bunny-pen"
        id="clone-btn">add bunny</button>
```

### Deleting clones

To delete a clone and remove it from shared state, call `playhtml.deleteElementData("can-duplicate", cloneId)` and remove the element from the DOM:

```js
document.querySelectorAll("[id^='bunny-template-']").forEach((el) => {
  playhtml.deleteElementData("can-duplicate", el.id);
  el.remove();
});
```

### Reset

No built-in reset shortcut. Deleting all clones (as above) is the equivalent.

---

## `can-hover`

Surfaces hover state from any visitor on the page. This is **presence-only** — state is not persisted and clears when a user leaves.

**Guide page:** [can-hover](/docs/capabilities/#can-hover)

### Data

`can-hover` stores no persistent shared data. Hover state is transmitted as **element awareness**: an ephemeral, per-connection signal scoped to this element.

**Awareness shape (per visitor):** `{ hover: boolean }`

### DOM effect

While any visitor is hovering the element, playhtml sets a `data-playhtml-hover` attribute on it (an empty-string attribute). When nobody is hovering, the attribute is removed.

Style the hover effect by targeting this attribute:

```css
/* Fires for everyone on the page when anyone hovers */
#my-card[data-playhtml-hover] {
  box-shadow: 0 0 0 3px #6366f1;
  transform: scale(1.03);
}
```

:::caution[Do not use `:hover`]
`:hover` only reflects your own pointer. Use `[data-playhtml-hover]` so the style applies when anyone hovers.
:::

### Reset

No reset shortcut. Hover awareness clears automatically when each visitor stops hovering or disconnects.

---

## `can-mirror`

Syncs an element's **attributes**, **direct child list**, and **form / contenteditable state** across all visitors. Edits made by any visitor are reflected on all others in real time. State is persistent.

**Full treatment with live demos:** [Custom elements → can-mirror](/docs/custom-elements/#can-mirror)  
**Interactive examples:** [Mirror playground](/docs/advanced/mirror-playground/)

### What gets synced

| Kind | Synced |
|---|---|
| Element attributes | Yes (excluding ephemeral playhtml-managed ones) |
| Direct children (child list and text nodes) | Yes |
| Form state: `<input>` value / checked, `<textarea>` value, `<select>` selectedIndex | Yes, via `input` and `change` events |
| Contenteditable content | Yes, via `input` and `change` events |
| Descendant mutations (arbitrary depth) | **No** — `can-mirror` only observes the element itself, not its subtree |

Ephemeral attributes (`data-playhtml-hover`, `data-playhtml-focus`) are not stored in the shared snapshot. They are driven by awareness instead.

### Data

**Type:** `ElementState` — an internal snapshot of the element's attributes, children, and form state at mount time. The shape is an implementation detail; interact with it only by reading the live DOM.

### Nested elements

`can-mirror` uses `subtree: false` on its MutationObserver — it does not recursively watch descendants. To sync mutations inside a child element, add a separate `can-mirror` attribute (and a stable `id`) to that child:

```html
<div can-mirror id="outer">
  <ul can-mirror id="inner-list">
    <li>item</li>
  </ul>
</div>
```

### Presence: `data-playhtml-hover` and `data-playhtml-focus`

`can-mirror` also tracks focus state via awareness. When any visitor focuses a descendant of the element, `data-playhtml-focus` is set on the element for all visitors. Style accordingly:

```css
#my-editor[data-playhtml-focus] {
  outline: 2px solid #6366f1;
}
```

### Reset

No reset shortcut.

---

## `can-play`

Define your own shared data and how the element renders (`updateElement` or experimental `view`). Use it for counters, guestbooks, games, and anything the built-ins do not cover.

**Guide:** [Custom elements](/docs/custom-elements/)  
**Reference:** [Element API](/docs/reference/element-api/) · [View API](/docs/reference/view-api/)

---

## Cross-capability facts

### `id` requirement

Every element that carries a capability attribute must have a **stable, unique `id`**. The id is the storage key — changing it between deployments loses the element's synced state. Omitting it causes playhtml to fall back to an HTML hash of the element, which can differ across browsers.

```html
<!-- Good: explicit, stable id -->
<img can-move id="hat-magnet" src="/hat.png" alt="" />

<!-- Risky: id-less; playhtml hashes the HTML -->
<img can-move src="/hat.png" alt="" />
```

### `selector-id`

For multiple same-template elements (e.g. a row of magnets all using the same markup), add `selector-id` with a shared CSS selector instead of hand-writing unique `id`s. playhtml assigns state slots by position — the N-th matching element gets the N-th slot.

```html
<div class="magnet" selector-id=".magnet" can-move>🍎</div>
<div class="magnet" selector-id=".magnet" can-move>🥐</div>
<div class="magnet" selector-id=".magnet" can-move>☕</div>
```

See [Dynamic elements](/docs/advanced/dynamic-elements/) for full details.

### Combining capabilities

You can place multiple capability attributes on one element. Each capability maintains its own independent data slot, keyed by `[capabilityName]-[elementId]`. They do not interfere with each other's state.

**Transform conflict:** `can-move`, `can-spin`, and `can-grow` all write `element.style.transform`. Combining two or more on the same element means each overwrites the other's transform on every update. Use `can-play` if you need a combined transform.

### Shift-click reset

`can-move`, `can-spin`, `can-toggle`, and `can-grow` reset on **shift-click** for everyone in the room. Custom `can-play` elements can opt in with `resetShortcut: "shiftKey"`.
