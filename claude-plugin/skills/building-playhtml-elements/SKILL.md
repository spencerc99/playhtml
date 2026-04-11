---
name: building-playhtml-elements
description: Use when building, creating, or implementing a playhtml element or component, whether in vanilla HTML or React. Triggers include requests to make interactive, collaborative, real-time, or multiplayer HTML elements.
---

# Building playhtml Elements

playhtml makes HTML elements collaborative and real-time via Yjs CRDTs.

## Before Implementing — Ask These Questions

If the user's request is ambiguous on ANY of these, **stop and ask**:

1. **Persistence**: Should data survive page refresh? (defaultData=yes, awareness=no)
2. **Shared vs per-user**: Should all users see the same state, or does each user have their own?
3. **Vanilla HTML or React?**

These determine which API and data type to use. Getting them wrong means a rewrite.

## Data Types

| Type | Persists? | Syncs? | Use for |
|------|-----------|--------|---------|
| `defaultData` | Yes | Yes | Positions, counts, messages, toggles |
| `myDefaultAwareness` | No | Yes | Who's online, typing, hover state |
| `dispatchPlayEvent` | No | One-shot | Confetti, notifications |
| `localStorage` | Yes | No | Per-user flags ("has reacted") |

## Critical Rules

- Every element MUST have a unique `id` attribute — without it, sync silently fails
- Vanilla HTML: Configure element properties BEFORE `playhtml.init()` (the #1 mistake)
- React: Wrap app in `<PlayProvider>`

## Quick Reference — Vanilla HTML (can-play)

```javascript
const el = document.getElementById("myElement");
el.defaultData = { count: 0 };                           // REQUIRED
el.updateElement = ({ element, data }) => { ... };        // REQUIRED
el.onClick = (e, { data, setData }) => { ... };
el.onDrag = (e, { data, setData, localData, setLocalData }) => { ... };
el.onDragStart = (e, { setLocalData }) => { ... };
el.onMount = ({ getData, setData, getElement }) => { ... };
el.resetShortcut = "shiftKey"; // "shiftKey"|"ctrlKey"|"altKey"|"metaKey"

// THEN import — ordering matters!
import { playhtml } from "https://unpkg.com/playhtml@latest";
playhtml.init();
```

## Quick Reference — React (withSharedState)

```tsx
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";

const Counter = withSharedState(
  { defaultData: { count: 0 } },
  ({ data, setData, ref }) => (
    <button ref={ref} onClick={() => setData({ count: data.count + 1 })}>
      {data.count}
    </button>
  )
);

// Component receives: data, setData, awareness, setMyAwareness, ref
// Config can be dynamic: withSharedState((props) => ({ defaultData: ... }), component)
// For events: usePlayContext() → { dispatchPlayEvent, registerPlayEventListener }
// For cursors: usePlayContext() → { cursors, configureCursors }
```

## setData — Two Forms

```javascript
// Value form: replaces ALL data (spread to preserve other fields!)
setData({ ...data, count: data.count + 1 });

// Mutator form: modify in place (preferred for arrays/nested)
setData((draft) => { draft.items.push(newItem); });
```

## Built-in Capabilities

Use instead of `can-play` when they fit:

- `can-move`: Draggable with x,y position
- `can-toggle`: Click to toggle on/off state
- `can-spin`: Rotatable element
- `can-grow`: Click to scale up/down
- `can-duplicate`: Click to clone element
- `can-hover`: Collaborative hover via awareness. Sets `data-playhtml-hover` attribute when ANY user hovers. Style with both `:hover` and `[data-playhtml-hover]`. No persistent data.
- `can-mirror`: Syncs full DOM state (attributes, children, form values) via MutationObserver. Also tracks hover/focus awareness. Good for rich content or form elements.

React components: `CanMoveElement`, `CanToggleElement`, `CanSpinElement`, `CanGrowElement`, `CanDuplicateElement`, `CanHoverElement`.

## Advanced APIs

For state or presence not tied to a DOM element:

- **`playhtml.createPageData(name, defaultValue)`**: Persistent shared data channel. Returns `{ getData, setData, onUpdate, destroy }`. Use for app-level state (shared settings, vote tallies, page metadata). Call after init.
- **`playhtml.createPresenceRoom(name)`**: Domain-scoped presence room. Returns `{ presence, destroy }`. Presence API: `setMyPresence(channel, data)`, `getPresences()`, `onPresenceChange(channel, cb)`, `getMyIdentity()`. Use for cross-page awareness (who's on which page, lobbies).
- **`playhtml.presence`**: Built-in page-level presence API (same shape). Available after init.

## Cursors (optional)

```javascript
playhtml.init({ cursors: { enabled: true, room: "page" } }); // "page"|"domain"|"section"
window.cursors.allColors.length; // user count
```

See `docs/cursors.md` for full API.

## Common Mistakes

1. **Config after init** (vanilla): Properties set after `playhtml.init()` are ignored. Configure FIRST.
2. **Missing `id`**: No id = no sync. Silent failure.
3. **Wrong data type**: Awareness for persistent data (disappears on disconnect) or defaultData for ephemeral presence (leaves stale data). Refer to the Data Types table.
4. **Bad array mutations**: In mutator form, the draft is a Yjs CRDT proxy. Use `push()`/`splice()` only — `shift()`, `pop()`, and `items[i] = x` don't sync correctly.
5. **Value form loses fields**: `setData({ x: 5 })` erases `y`. Always spread: `setData({ ...data, x: 5 })` or use mutator form.
6. **Deep nesting**: CRDTs work best with flat data. Avoid deeply nested objects.
7. **High-frequency updates**: Don't `setData` on every mousemove. Debounce, or use `setLocalData`/awareness.
8. **Computed values in state**: Don't store what you can calculate. Compute in `updateElement`/render.
9. **Missing PlayProvider** (React): `withSharedState` silently fails without it.
