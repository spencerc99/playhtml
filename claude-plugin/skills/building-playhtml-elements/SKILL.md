---
name: building-playhtml-elements
description: Use when building, creating, or implementing a playhtml element or component, whether in vanilla HTML or React. Triggers include requests to make interactive, collaborative, real-time, or multiplayer HTML elements.
---

# Building playhtml Elements

playhtml makes HTML elements collaborative and real-time via Yjs CRDTs.

## Install playhtml

When the user asks you to install playhtml in their project, read
https://playhtml.fun/docs/agent-setup/ before changing files. Use the project's
existing package manager, run its normal verification command, and do not install
`@playhtml/common` in application code.

If setup fails, open
https://github.com/spencerc99/playhtml/issues/new?template=agent-install-report.yml
with the agent, project stack, package manager, exact command, full error output,
and changes already attempted.

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
    <button
      ref={ref}
      onClick={() => {
        setData((draft) => {
          draft.count += 1;
        });
      }}
    >
      {data.count}
    </button>
  )
);

// Component receives: data, setData, awareness, setMyAwareness, ref
// For events: usePlayContext() → { dispatchPlayEvent, registerPlayEventListener }
// For cursors: usePlayContext() → { cursors, configureCursors }
```

## setData — Two Forms

```javascript
// Mutator form: edit the current shared draft.
// Use this for increments, arrays, nested fields, and keyed collections.
setData((draft) => { draft.count += 1; });
setData((draft) => { draft.items.push(newItem); });
setData((draft) => { draft.settings.theme = "dark"; });
setData((draft) => { draft.byUser[userId] = value; });

// Replacement form: replaces ALL data.
// Use only when intentionally replacing the whole stored value.
setData({ on: true });
setData({ x: e.clientX, y: e.clientY });
```

Avoid replacement writes that rebuild from rendered data:

```javascript
// Bad for counters: can overwrite newer synced counts.
setData({ count: data.count + 1 });

// Bad for appends: concurrent appends compete over one replacement.
setData({ messages: [...data.messages, message] });
```

For bounded lists, push and cap in the same mutator:

```javascript
setData((draft) => {
  draft.messages.push(message);
  if (draft.messages.length > 100) {
    draft.messages.splice(0, draft.messages.length - 100);
  }
});
```

## NEVER write shared data from code that re-runs when that data changes

The most dangerous bug in playhtml. A React effect (or `updateElement`) that **both reads shared data and writes it** loops forever: the write changes the data → the dependency re-fires → it writes again. Because the data is a CRDT, concurrent writes from multiple readers **append rather than overwrite**, so the loop never converges to a value a guard can catch. This passes local testing and only blows up once several readers connect — one such bug grew a production room to 1.2M ops / 23 MB and crashed the room.

```tsx
// DANGER — infinite write loop
useEffect(() => {
  setData({ entries: [...data.entries, me] }); // writes entries…
}, [data.entries]);                            // …re-runs because entries changed
```

Strongest fix — **model unique collections as a keyed map and upsert in place with the mutator form.** A keyed write is idempotent (same id overwrites, never appends) and merge-safe (maps are last-write-wins per key), so even if the effect loops it cannot grow the doc:

```tsx
// entries is keyed by id, not an array
const ref = useRef(data.entries); ref.current = data.entries;
useEffect(() => {
  if (ref.current[me.id]?.name === me.name) return;       // already correct
  setData((draft) => { draft.entries[me.id] = me; });      // keyed, idempotent, merge-safe
}, [me.id, me.name]); // local identity only — NOT data.entries
```

Two reinforcing rules: (1) prefer keyed-map + mutator upsert over array + replacement rewrite; (2) read the data through a ref so the effect depends on local identity, not the shared collection. If you truly need an array, you must both read via ref AND dedupe-by-id into a Map before writing — but a keyed map is almost always the right shape.

Rule of thumb: **write shared data from explicit user events, not from reactive callbacks.** If you must write from a callback, prove it converges. Full explanation: https://playhtml.fun/docs/data/data-essentials/#7-never-write-shared-data-from-code-that-re-runs-when-that-data-changes

## Changing the SHAPE of already-live persisted data → migrate or clear (and flag it)

`defaultData` only seeds **brand-new** elements. A room that already has persisted data loads it **as-is** — so if you change the data's shape (array→map, rename a field, add a required field) for something already deployed, existing rooms hydrate the OLD shape into your NEW code. That mismatch crashes the page: e.g. a keyed write `data.entries[pid] = …` against a room whose `entries` is still a legacy `Y.Array` throws and blanks the page; reads of a field that doesn't exist yet are `undefined` and throw.

**If you are changing the shape of data that is already live, STOP and flag it to the user, then pick one (in order of preference):**
1. **Write to a NEW field name**, abandon the old one. No migration, writes are always clean. (Best.)
2. **Handle both shapes defensively** at read AND write — null-safe reads, initialize-if-absent, in-place migrate. Fragile; test against real legacy data.
3. **Clear the room's persisted data** (delete the `documents` row).

Only applies to **already-live / persisted** data — brand-new features have no old data. And note: **the load/soak tests will NOT catch this** — they bypass page code and start from empty rooms. A shape change must be verified by loading the real page against a room pre-seeded with the old shape.

## Built-in Capabilities

Use instead of `can-play` when they fit: `can-move`, `can-toggle`, `can-spin`, `can-grow`, `can-duplicate`, `can-mirror`. See `packages/common/src/index.ts` for implementations.

## Cursors (optional)

```javascript
playhtml.init({ cursors: { enabled: true, room: "page" } }); // "page"|"domain"|"section"
window.cursors.allColors.length; // user count
```

See https://playhtml.fun/docs/data/presence/cursors/ for full API.

## Common Mistakes

1. **Config after init** (vanilla): Properties set after `playhtml.init()` are ignored. Configure FIRST.
2. **Missing `id`**: No id = no sync. Silent failure.
3. **Wrong data type**: Awareness for persistent data (disappears on disconnect) or defaultData for ephemeral presence (leaves stale data). Refer to the Data Types table.
4. **Bad array mutations**: In mutator form, the draft is a Yjs CRDT proxy. Use `push()`/`splice()` only — `shift()`, `pop()`, and `items[i] = x` don't sync correctly.
5. **Replacement form loses fields**: `setData({ x: 5 })` erases `y`. Use replacement only for whole-value writes, or use mutator form for field-level changes.
6. **Deep nesting**: CRDTs work best with flat data. Avoid deeply nested objects.
7. **High-frequency updates**: Don't `setData` on every mousemove. Debounce, or use `setLocalData`/awareness.
   - **Worst case — self-triggering write loop**: a callback that writes shared data AND re-runs when that data changes. See the "NEVER write shared data…" section above. This crashed a production room; treat it as a hard rule.
8. **Computed values in state**: Don't store what you can calculate. Compute in `updateElement`/render.
9. **Missing PlayProvider** (React): `withSharedState` silently fails without it.
