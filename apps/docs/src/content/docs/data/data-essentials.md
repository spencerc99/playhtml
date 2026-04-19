---
title: "Data essentials"
description: "How to shape, update, and clean up the data attached to a playhtml element."
sidebar:
  order: 1
---

Every playhtml element owns a piece of shared data. Getting the shape right, writing to it correctly, and cleaning it up when elements go away are the three skills that separate a toy demo from a real feature. This page covers all three.

## Updating data: mutator vs replacement

`setData` accepts two shapes, and the one you pick determines merge semantics. Picking wrong can silently clobber concurrent edits from other readers.

### Mutator form (merge-friendly)

Pass a function that receives a draft and mutate it in place. playhtml ships only the delta, so two readers appending to the same list will both land. **This is the recommended form for anything containing arrays or nested objects.**

```js
setData((draft) => {
  draft.messages.push({ text: "hello" });
});
```

### Replacement form (overwrite)

Pass a full value. This replaces the entire snapshot. Last write wins. Safer for booleans and small atomic objects where "the whole thing" is always what you mean.

```js
setData({ ...data, on: !data.on });
```

### Supported array operations in mutator form

The mutator form is backed by a CRDT, which means a specific subset of array operations are safe. Everything else either silently no-ops or throws.

**Supported:**

```js
setData((draft) => {
  draft.items.push(newItem);

  draft.items.splice(0, 1);              // remove first
  draft.items.splice(2, 0, newItem);     // insert at index 2
  draft.items.splice(2, 1, replacement); // replace element at index 2

  draft.items[0].name = "updated";       // mutating a nested object IS fine
});
```

**Unsupported (throws at runtime):**

```js
setData((draft) => {
  draft.items.shift();          // use splice(0, 1)
  draft.items.pop();            // use splice(-1, 1)
  draft.items[index] = newItem; // use splice(index, 1, newItem)
});
```

The throwing errors read "array assignment is not implemented / supported". If you hit one, translate it into the matching `splice` call.

## Shaping your data

How you lay out the object you pass to `defaultData` has a real effect on performance, sync bandwidth, and how painful the code is to refactor later. Seven rules, in order of frequency.

### 1. Keep shapes flat

Deeply nested objects are harder to update, slower to sync, and more conflict-prone. One level of nesting is fine for obviously-related fields; beyond that, flatten.

```js
// Good
defaultData: { x: 0, y: 0, color: "#ff0000", size: 100 }

// Acceptable (one level, fields are clearly related)
defaultData: { position: { x: 0, y: 0 }, color: "#ff0000" }

// Avoid
defaultData: {
  position: { coords: { x: 0, y: 0 } },
  style: { appearance: { color: "#ff0000" } },
}
```

### 2. Don't store computed or derived values

Compute them in `updateElement` (vanilla) or the render function (React). Storing them means they go stale whenever the source changes and you forget.

```js
// Good
defaultData: { count: 5 }
updateElement: ({ element, data }) => {
  const parity = data.count % 2 === 0 ? "even" : "odd";
  element.textContent = `${data.count} (${parity})`;
}

// Avoid
defaultData: { count: 5, isEven: false }
```

Common offenders: formatted date strings, totals/averages, filtered/sorted arrays, boolean flags derived from other fields.

### 3. Pick the right data type

playhtml gives you three places to put state. Use the one that matches the lifetime you actually want.

| Type | Survives reload | Use for |
|---|---|---|
| Persistent (`defaultData`) | Yes | Positions, counts, messages, settings, toggles |
| Presence / awareness | No | Who's online, typing indicators, colors, per-user cursor data |
| Events | No (fire once) | Confetti bursts, notifications, chimes |

If someone refreshes the page and expects the state to still be there, it's persistent data. If a new reader opening the page for the first time should _not_ see a historical replay, it's presence or an event.

### 4. Don't update on high-frequency DOM events

Syncing on every `mousemove` or `scroll` will flood the socket and eat your PartyKit bill. Three options, in order of preference:

**Use built-in handlers** — `onDrag`, `onMount` already debounce:

```js
element.onDrag = (e, { setData }) => {
  setData({ x: e.clientX, y: e.clientY });
};
```

**Debounce yourself** when you need your own event:

```js
let pending;
element.addEventListener("mousemove", (e) => {
  clearTimeout(pending);
  pending = setTimeout(() => setData({ x: e.clientX, y: e.clientY }), 100);
});
```

**Local-state-then-commit** — keep ephemeral state local, sync only on the commit event (mouseup, blur, submit):

```js
let localX = data.x;
element.addEventListener("mousemove", (e) => {
  localX = e.clientX;
  element.style.left = `${localX}px`;
});
element.addEventListener("mouseup", () => {
  setData({ x: localX });
});
```

### 5. Bound growing lists

An unbounded `messages` / `history` array will grow forever. It survives every reload, which means the load cost compounds.

```js
// Keep last 100
setData((draft) => {
  draft.messages.push(newMessage);
  if (draft.messages.length > 100) {
    draft.messages.splice(0, draft.messages.length - 100);
  }
});

// Or time-bucket
setData((draft) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  draft.messages = draft.messages.filter((m) => m.timestamp > cutoff);
  draft.messages.push(newMessage);
});
```

For moderated sites with long histories, store only recent items in shared state and fetch the archive from your own DB.

### 6. Store only what needs to sync

UI-only state, loading flags, animation state — none of that belongs in shared data. Use component state (React) or plain variables (vanilla).

```js
// Bad — every reader sees every other reader's hover
defaultData: { isHovering: false }

// Good — hover is a local concern
element.addEventListener("mouseenter", () => element.classList.add("hover"));
```

If you _do_ want collaborative hover, use [`can-hover`](/docs/capabilities/) — that's literally its reason to exist, and it uses presence (not persistent data) under the hood.

### 7. Use `localStorage` for per-user preferences

Some state is personal: "has this user already reacted", collapsed sections, display-name choice, notification settings. That data should _not_ sync.

```js
const reactedKey = `reacted-${elementId}`;
const hasReacted = Boolean(localStorage.getItem(reactedKey));

onClick: (_e, { data, setData }) => {
  if (hasReacted) {
    setData({ count: data.count - 1 });
    localStorage.removeItem(reactedKey);
  } else {
    setData({ count: data.count + 1 });
    localStorage.setItem(reactedKey, "true");
  }
};
```

## Anti-patterns

Three mistakes that show up often enough to call out explicitly.

**Syncing UI state** — hover, focus, loading, animation progress. These should be local.

**Over-normalizing** — playhtml data is a document, not a relational database. A flat array of message objects beats a `users: {…}` + `messages: {…}` split every time.

```js
// Too normalized for playhtml
{ users: { "u1": { name: "Alice" } }, messages: { "m1": { userId: "u1", text: "Hi" } } }

// Simpler, faster, less to maintain
{ messages: [{ id: "m1", author: "Alice", text: "Hi" }] }
```

**Unbounded arrays with no cleanup** — any `push` without a matching size check will eventually bite you.

## Cleaning up

When you delete an element at runtime, its playhtml data stays behind by default. For element types like `can-move` that store per-element position data, this accumulates fast.

### Runtime cleanup

```js
playhtml.deleteElementData("can-move", elementId);
```

This removes the SyncedStore entry, observer subscriptions, element handlers, and any legacy globalData entries.

Example — a fridge magnet app deleting words:

```tsx
function handleDeleteWord(id: string) {
  setWords((prev) => prev.filter((w) => w.id !== id));

  if (window.playhtml) {
    window.playhtml.deleteElementData("can-move", id);
  }
}
```

### Admin cleanup (bulk)

For sites that didn't clean up at runtime and need to sweep orphans, there's an admin endpoint.

```
POST /parties/main/{roomId}/admin/cleanup-orphans
```

```json
{
  "tag": "can-move",
  "activeIds": ["id1", "id2", "id3"],
  "dryRun": false
}
```

```json
{
  "ok": true,
  "tag": "can-move",
  "total": 5000,
  "active": 100,
  "removed": 4900,
  "message": "Removed 4900 orphaned entries"
}
```

There's a helper script in the repo for doing this from a terminal:

```bash
export ADMIN_TOKEN=your_token_here

# Dry run first to see what would be removed
DRY_RUN=true bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2" "id3"

# Actually perform the cleanup
bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2" "id3"
```

**Practice:** always dry-run first; always derive the `activeIds` list from your own data store, never from the playhtml state you're about to delete.

## Performance checklist

When reviewing a new element's data shape:

- Is this actually shared, or should it be local?
- Could it be derived from other data instead of stored?
- Will the arrays grow unbounded?
- Am I about to update on a high-frequency DOM event?
- Is there a built-in `can-*` capability that already does this?
- Should this live in presence / events instead of persistent data?
- Are there per-user preferences that want `localStorage`?
