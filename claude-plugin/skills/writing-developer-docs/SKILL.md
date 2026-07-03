---
name: writing-developer-docs
description: Use when writing or editing developer-facing documentation, guides, references, READMEs, or API docs. Triggers include requests to write docs, document a feature/API, simplify or clarify docs, or make writing plainer and more developer-friendly.
---

# Writing Developer Docs

Write for a developer who is busy, skimming, and trying to get something working.
Plain, concrete, and short beats clever and complete. Optimize for "I understood
it on the first read and knew what to do next."

## The core principle: plain language

Say the thing directly. Cut the marketing voice, the metaphors, and the throat-clearing.

- **No flourish vocabulary.** Drop "escape hatch," "meta-capability," "powerful,"
  "seamless," "magic," "simply," "just," "the general-purpose X." Name what it
  *is* and what it *does*.
- **Lead with the outcome, then the mechanism.** "Syncs every change to the
  element to everyone, and saves them" before "uses a MutationObserver."
- **Concrete over abstract.** Show the attribute, the function call, the shape of
  the data. "Use `{ count: 0 }`, not `0`" beats "prefer structured defaults."
- **One idea per sentence.** If a sentence has two "and"s and a dash, split it.
- **Active voice, present tense.** "playhtml syncs the data" not "the data will
  be synced."
- **Define the tradeoff plainly.** Tell them what they give up, not just what they
  get. "No fine-grained control over what syncs, but very simple to start."

### Before / after

> ❌ **`can-mirror`** — no data model at all. The library mirrors the element's
> own DOM to everyone, so **the state you share _is_ the DOM**. The
> general-purpose escape hatch.

> ✅ **`can-mirror`**: The DOM holds the state. All changes to the element are
> automatically synced (attributes, children, form state). No fine-grained
> control over what is synced, but very simple to get started because you can
> just write normal HTML, CSS, and JavaScript.

The good version names the model ("the DOM holds the state"), lists what's covered,
states the tradeoff, and tells them why they'd pick it — in plain words.

## Structure

- **Answer "what is this and why" in the first two sentences** of any page or
  section. A reader who stops there should still come away with the gist.
- **Compare alternatives side by side** when there's more than one way to do
  something. A short bullet per option, each saying what it's good at and what it
  costs, beats prose that buries the distinction.
- **Order by how common the use is**, not by how the code is organized. Most
  people want the simplest thing first.
- **Every concept gets a runnable example.** Prefer a complete, copy-pasteable
  snippet over a fragment. Show the data shape and the call site.
- **Headings are navigation.** Make them scannable and parallel. Don't bury a
  must-know caveat inside a paragraph — give it its own callout.

## What to avoid

- **Don't explain the implementation when the user only needs the behavior.**
  "Persists per room" (consequence) not "stored in a Yjs doc keyed by pathname"
  (mechanism) — unless the mechanism is the thing being documented.
- **Don't leak internal-only concerns** into user docs: internal tooling, infra,
  test gaps, incident history, private module names. Write "here's how to use
  this," never "here's how we operate it."
- **Don't pad.** If a sentence doesn't change what the reader does, cut it.
- **Don't over-hedge.** State the rule, then the exception. "Write from user
  events. The one exception: …"

## Repo conventions (playhtml)

User-facing docs live in `apps/docs/` (Astro + Starlight). When you change docs:

- **Vanilla + React splits** use `<Tabs syncKey="framework">` with
  `<TabItem label="Vanilla HTML">` / `<TabItem label="React">`. Labels must be
  **exactly** those strings on every page (Starlight syncs by label text).
  MDX gotcha: a markdown list as the last content before `</TabItem>` fails to
  parse — end the tab on prose or a code block.
- **Page-wide `<Tabs>` caveat:** Starlight builds the right-rail table of contents
  from *every* `###` on the page, including ones inside inactive tabs. Wrapping a
  whole page in one framework toggle therefore shows duplicate / hidden-tab
  headings in the ToC and collides anchor slugs. If you need a page-level toggle,
  demote per-example headings to bold labels so they stay out of the ToC.
- **`base: "/docs"`** means asset URLs need the `/docs/` prefix (`/docs/foo.png`).
- When code under `packages/` changes public behavior, update the matching
  `apps/docs/` page in the same change, and add a changeset.
- Internal planning/notes go in `internal-docs/` (gitignored), never in
  `apps/docs/`.

## Checklist before you're done

- [ ] First two sentences explain what it is and why you'd use it.
- [ ] No flourish words; every sentence earns its place.
- [ ] Each option states its tradeoff, not just its upside.
- [ ] Every concept has a copy-pasteable example with the real data shape.
- [ ] No internal mechanics or maintainer concerns leaked in.
- [ ] Tabs labels exact; no markdown list right before `</TabItem>`.
- [ ] Docs build clean (`bun build-site`).
