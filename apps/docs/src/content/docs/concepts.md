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

- **Element data** (`defaultData` / [`can-play`](/docs/capabilities/)) belongs to one element: a toggle's on/off, a draggable's position, a shared count. See [data essentials](/docs/data/data-essentials/).
- **Page data** (`playhtml.createPageData`) has a name instead of an element: a page-wide counter, a shared prompt, an open vote. See [page-level data](/docs/data/page-data/).

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

See [people and presence](/docs/data/presence/) and [cursors](/docs/data/presence/cursors/).

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

Not sure which one you want? The [decision table on data essentials](/docs/data/data-essentials/#when-to-use-which-primitive) lays out the tradeoffs side by side.

## Every element needs a stable id

Element data is stored under the element's `id`, so the id must stay the same across reloads and browsers. That's how two visitors agree on which element is which. A hand-written `id="my-lamp"` is ideal. If you leave it out, playhtml falls back to hashing the element's HTML, which can differ across browsers and break sync.

For **many elements that share a selector** (a row of magnets, a list of reactions), give each the same markup and add a single `selector-id` attribute instead of inventing unique ids. playhtml indexes the matches by position, so the N-th `.magnet` always gets the N-th slot of state. See [Dynamic elements](/docs/advanced/dynamic-elements/#many-of-a-kind-elements-with-selector-id).
