---
title: "Core concepts"
description: "What playhtml shares: data about the things on your page, the people looking at it, and one-off events."
sidebar:
  order: 2
---

playhtml shares two things between everyone on a page: **the things on the page** (a lamp that's on, a hat that's been dragged, a vote count) and **the people looking at it** (who's here, what color they are, what they're doing right now). Everyone visiting the same url shares one room, so whatever you change shows up for everyone else too.

![A page running playhtml with four callouts: element data bound to a specific element, page data read by name anywhere on the page, people with their cursors and what they're doing right now, and one-off events. Element and page data are saved; people's presence and events are live only. Faded pages behind show that everyone on the same url shares one room.](/docs/how-playhtml-works-overview.png)

Once you can tell which one you need, everything else is attribute and function names.

## Things on the page: shared data

Shared data is saved. It survives reloads, and someone who opens the page tomorrow sees it.

- **Element data** belongs to one element: a toggle's on/off, a draggable's position, a shared count. [Built-in elements](/docs/capabilities/) come with theirs; [custom elements](/docs/custom-elements/) set it with `defaultData`.
- **Page data** (`playhtml.createPageData`) has a name instead of an element: a page-wide counter, a shared prompt, an open vote. See [page-level data](/docs/data/page-data/).

Each element's data is stored under its `id`, so the element with the same `id` on everyone's page stays in sync:

![Two browsers open to the same page. Each interactive element (a lamp with can-toggle, a hat with can-move, a wheel with can-spin, a balloon with can-grow, and a custom can-play guestbook holding a list of entries) has its own data object keyed by element id, saved by the playhtml server. A change on one page syncs through the server and the matching element updates on the other page. Above the elements, a "people here" panel shows each person's presence, which is gone when they leave: Ana is marked as you on her page, and Sam shows a typing indicator on both pages.](/docs/how-playhtml-works.png)

## People: who's here and what they're doing

`playhtml.people.everyone` is everyone on the page right now, including you. Each person looks like this:

```js
{ pid, name, color, isMe, presence }
```

- **`name` and `color`** are who someone is. They follow a person from visit to visit, and you set your own with `playhtml.people.me.name = "Ana"`.
- **`presence`** is what someone is doing right now: typing, hovering the lamp, ready to start. Everyone can see it, only that person can set it, and it disappears when they leave.

Presence comes in two places, and both use the same names:

- **On the page:** `playhtml.people.setMyPresence("status", "typing")`, read from each person's `presence.status`. Cursors are page presence that playhtml fills in for you, at `person.presence.cursor`.
- **On an element:** inside an element, `everyone`, `me`, and `setMyPresence` describe the people using that element and their presence on it. "Who's hovering this card" is element presence.

See [people and presence](/docs/data/presence/) and [cursors](/docs/advanced/cursors/).

## Events: moments

**Events** (`playhtml.dispatchPlayEvent`) are one-off broadcasts that change nothing: confetti, a chime, a notification. Whoever is here when it fires sees it; nobody else ever does. See [events](/docs/data/events/).

## Inside one element

An element can hold three kinds of state, and they differ in who sees them and how long they last:

| | Who sees it | How long it lasts | Write it with | Read it as |
| --- | --- | --- | --- | --- |
| **data** | Everyone | Saved, survives reloads | `setData` | `data` |
| **presence** | Everyone | Until you leave | `setMyPresence` | `me.presence`, and each person's `presence` in `everyone` |
| **localData** | Only you, in this tab | Until you reload | `setLocalData` | `localData` |

A lamp's on/off is data. Who's hovering it is presence. Whether your settings panel is open is local data.

Not sure which one you want? The [table below](#when-to-use-which-primitive) lays out the tradeoffs side by side.

## When to use which primitive

playhtml has a few ways to move state between readers. Pick by **lifetime** first ("should this survive a reload?"), then by **scope** ("does this belong to one element, the whole page, or one person?").

| Want | Use | Survives reload | Scope |
|---|---|---|---|
| A toggle, position, count, or any state tied to one element | [Element data](/docs/custom-elements/) (`defaultData` / `can-play`) | Yes | One element |
| A page-wide counter, prompt, or vote not tied to a DOM node | [Page data](/docs/data/page-data/) (`playhtml.createPageData`) | Yes | One page |
| "Who is here right now?" / "How many readers?" | [People](/docs/data/presence/) (`playhtml.people.everyone`) | No | Per person |
| "Who's typing?" / a live status for the whole page | [Page presence](/docs/data/presence/#page-presence) (`playhtml.people.setMyPresence`) | No | Per person |
| "Who's hovering this card?" / state about one element | [Element presence](/docs/data/presence/#element-presence) (`defaultPresence`, `setMyPresence`) | No | Per person, one element |
| "Where is everyone's cursor?" | [Cursors](/docs/advanced/cursors/) (`person.presence.cursor`) | No | Per person |
| Confetti burst, chime, notification | [Events](/docs/data/events/) (`dispatchPlayEvent`) | No (fires once) | Broadcast |
| "How many people reacted to this post?" | Element data (a `count` field) | Yes | One element |

Two rules that catch most mistakes:

- **If a new reader opening the page should see the state, it's persistent data.** If they shouldn't, it's presence or an event.
- **If you're reaching for `localStorage` to make state survive a reload, you wanted persistent data.** Use `localStorage` for _per-user_ preferences that should _not_ sync; see [per-user preferences](/docs/advanced/data-best-practices/#8-use-localstorage-for-per-user-preferences).

## Writing and shaping data

A few habits keep shared data small, fast, and free of conflicts. Each one links to the full explanation and examples.

- **Use the mutator form for counts and lists.** `setData((draft) => { draft.count += 1 })` merges with other people's edits; passing a whole new value replaces theirs. See [mutator vs replacement](/docs/advanced/data-best-practices/#updating-data-mutator-vs-replacement).
- **Keep shapes flat, and don't store values you can compute.** Store the raw facts and derive totals or labels when you render. See [shaping your data](/docs/advanced/data-best-practices/#shaping-your-data).
- **Don't write on every mouse move or scroll.** Write when the action finishes, or use presence or cursors for live motion. See [high-frequency events](/docs/advanced/data-best-practices/#4-dont-update-on-high-frequency-dom-events).
- **Cap lists that grow forever.** Trim old guestbook entries or messages as you add new ones. See [bound growing lists](/docs/advanced/data-best-practices/#5-bound-growing-lists).
- **Never write shared data from code that re-runs when that data changes**, such as a React effect that depends on `data` or inside `update`. Write from clicks and other user actions. See [why](/docs/advanced/data-best-practices/#7-never-write-shared-data-from-code-that-re-runs-when-that-data-changes).

When elements go away for good, you can delete their data; see [cleaning up](/docs/advanced/data-best-practices/#cleaning-up). For how numbers, lists, and keyed collections merge, see [merging data changes](/docs/advanced/merging-data/).

## Every element needs a stable id

Element data is stored under the element's `id`, so the id must stay the same across reloads and browsers. That's how two visitors agree on which element is which. A hand-written `id="my-lamp"` is ideal. If you leave it out, playhtml falls back to hashing the element's HTML, which can differ across browsers and break sync.

For **many elements that share a selector** (a row of magnets, a list of reactions), give each the same markup and add a single `selector-id` attribute instead of inventing unique ids. playhtml indexes the matches by position, so the N-th `.magnet` always gets the N-th slot of state. See [Dynamic elements](/docs/advanced/dynamic-elements/#many-of-a-kind-elements-with-selector-id).
