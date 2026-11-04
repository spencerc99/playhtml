---
title: "Data essentials"
description: "Which kind of shared state to use: element data, people and presence, page data, or events."
sidebar:
  order: 1
---

Every playhtml element owns a piece of shared data, keyed by the element's `id`. When you change an element, its data updates and syncs to everyone else on the page — the element with the same `id` on their side updates to match. This page helps you pick the right kind of state, with a few rules for writing it. The full details are in [data best practices](/docs/advanced/data-best-practices/).

![Two browsers open to the same page. Each interactive element (a lamp with can-toggle, a hat with can-move, a wheel with can-spin, a balloon with can-grow, and a custom can-play guestbook holding a list of entries) has its own data object keyed by element id, saved by the playhtml server. A change on one page syncs through the server and the matching element updates on the other page. Above the elements, a "people here" panel shows each person's presence, which is gone when they leave: Ana is marked as you on her page, and Sam shows a typing indicator on both pages.](/docs/how-playhtml-works.png)

## When to use which primitive

playhtml has a few ways to move state between readers. Pick by **lifetime** first ("should this survive a reload?"), then by **scope** ("does this belong to one element, the whole page, or one person?").

| Want | Use | Survives reload | Scope |
|---|---|---|---|
| A toggle, position, count, or any state tied to one element | [Element data](/docs/data/data-essentials/) (`defaultData` / `can-play`) | Yes | One element |
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
