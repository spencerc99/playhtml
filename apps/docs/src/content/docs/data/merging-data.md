---
title: "Merging data changes"
description: "How to avoid clobbering shared numbers, lists, maps, and nested data."
sidebar:
  order: 2
---

Shared data can be edited by more than one reader at the same time. The easiest way to keep those edits smooth is to choose the data shape and `setData` form that match the kind of merge you want.

## Quick rules

- Use the **mutator form** when the update builds on the current shared value: increments, decrements, list appends, list removals, nested field edits, and keyed upserts.
- Use the **replacement form** only when the write intentionally replaces the whole value you store.
- Use **arrays** for ordered histories where every append should remain, like chat messages, guestbook entries, or activity logs.
- Use **keyed objects** for unique collections, like one reaction per user, a roster keyed by user id, or one card per item id.
- Write shared data from explicit user events. Reactive callbacks need an idempotent guard so they do not keep writing in response to their own writes.

## Numbers and totals

Counts, totals, votes, and scores should usually use the mutator form. It applies your increment to the current draft value instead of replacing shared data with a rendered snapshot.

```js
setData((draft) => {
  draft.count += 1;
});
```

Avoid this for shared counters:

```js
setData({ count: data.count + 1 });
```

That replacement copies the `data` value your code last rendered. If another reader updates the same count between render and click, the replacement can write from a stale value.

## Ordered lists

Use arrays when order matters and every entry should remain. Common examples: messages, guestbook signatures, copied-code tallies, recent activity, or a drawing history.

```js
setData((draft) => {
  draft.messages.push({
    id: crypto.randomUUID(),
    author,
    text,
    createdAt: Date.now(),
  });
});
```

For bounded histories, cap the array in the same mutator:

```js
setData((draft) => {
  draft.messages.push(newMessage);
  if (draft.messages.length > 100) {
    draft.messages.splice(0, draft.messages.length - 100);
  }
});
```

Avoid rebuilding the whole array from a rendered snapshot:

```js
setData({ messages: [...data.messages, newMessage] });
```

That shape is easy to write, but it makes concurrent appends compete over one whole replacement.

## Unique collections

Use keyed objects when each logical item should appear once. Common examples: one vote per user, one roster entry per user, one reaction per emoji, one card per id, or one cursor label per participant.

```js
setData((draft) => {
  draft.votesByUser[userId] = {
    choice,
    updatedAt: Date.now(),
  };
});
```

The key is the merge boundary. Two users writing different keys can both land. The same user writing the same key updates that one entry instead of duplicating it.

If you need display order, keep it separate from identity:

```js
defaultData: {
  cardsById: {},
  cardOrder: [],
}
```

Then upsert the card by id and use `cardOrder.push(id)` only when the id is not already present.

## Nested fields

When a shared object has multiple fields that can change independently, mutate the field you mean to change.

```js
setData((draft) => {
  draft.settings.theme = "dark";
});
```

Avoid replacing a whole parent object unless you mean to replace every field on it. A replacement like this can accidentally drop another reader's update to `language`:

```js
setData({
  ...data,
  settings: {
    theme: "dark",
  },
});
```

## Whole-value replacements

Replacement writes are still useful when the stored value is intentionally a single value or a complete snapshot.

Good fits:

- a boolean toggle stored as the whole data object
- a selected mode where the latest choice should win
- a drag position committed after the drag ends
- a reset button that intentionally restores the entire data shape

```js
setData({ on: true });
```

For multi-field data, the mutator form is usually clearer:

```js
setData((draft) => {
  draft.on = true;
});
```

## Reactive callbacks

The riskiest conflict is a callback that reads shared data, writes shared data, and re-runs when that same data changes. React effects, subscriptions, and vanilla `updateElement` callbacks can all do this.

```tsx
useEffect(() => {
  setData({ entries: [...data.entries, me] });
}, [data.entries]);
```

Prefer explicit user events. If a reactive callback really needs to write shared data, make it idempotent:

```tsx
const entriesRef = useRef(data.entries);
entriesRef.current = data.entries;

useEffect(() => {
  if (entriesRef.current[me.id]?.name === me.name) return;

  setData((draft) => {
    draft.entries[me.id] = me;
  });
}, [me.id, me.name]);
```

The effect depends on local identity, not the shared collection it writes. The keyed write also converges: writing the same id twice updates the same entry instead of adding another one.

## Choosing a shape

| Data | Shape | Write |
|---|---|---|
| Reaction count, score, vote total | `{ count: 0 }` | `draft.count += 1` |
| Chat, guestbook, activity log | `{ messages: [] }` | `draft.messages.push(message)` |
| One value per user | `{ byUser: {} }` | `draft.byUser[userId] = value` |
| Editable nested settings | `{ settings: { ... } }` | `draft.settings.field = value` |
| Single latest mode | `{ mode: "idle" }` | replacement or `draft.mode = "active"` |

If you are not sure, start with the mutator form. It is the safer default for collaborative data because it says exactly which part of the shared object you intend to change.
