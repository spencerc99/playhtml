# Portrait Navigation — Decision Doc

> Scratch pad for deciding the UX between per-domain overlay and full portrait view.
> Delete this file once implemented.

---

## Two distinct experiences

| Experience | Scope | Where |
|---|---|---|
| **Page ghost** | Current domain only | Overlay injected on the current tab |
| **Full portrait** | All events, all time | Hosted page at `internet-series/movement` |

These serve different purposes and don't need to be the same screen. The question is: how does the user navigate between them?

---

## Options

### A — Two separate buttons in popup (explicit, zero steps)

Popup shows two clearly-named buttons:
- **"View page ghost"** → toggles overlay on current tab
- **"Open portrait"** → opens `internet-series/movement` in a new tab

No ambiguity. User picks the scope they want upfront. The hosted portrait page passively shows all events when you visit it.

**Pro:** Simple, obvious, no hidden steps.
**Con:** Slightly more popup real estate. "Two buttons for the same thing" might confuse.

---

### B — Special page detection (zero UI, URL is the switch)

Extension detects when you're on `internet-series/movement` and automatically shows all-events mode in the overlay. On every other page, overlay is per-domain.

Popup has one button: "Open portrait" → opens hosted page. The overlay on that page automatically shows everything.

**Pro:** Elegant. No toggle, no decision. URL = scope.
**Con:** User might not realize overlay on the portrait page is different. Also: user can't get a full portrait view on their current page — they must leave.

---

### C — Scope toggle in the overlay HUD

Overlay's info bar gets a scope control: `[ this domain ] [ all time → ]` where "all time" navigates to the portrait page.

**Pro:** In-context. User can escalate scope without opening popup.
**Con:** Adds chrome to the overlay HUD. More complex overlay state. Feels like scope-switching when the real difference is "local vs. hosted page".

---

## Current lean

**Option B + A hybrid:**

- Popup has two buttons with clear scope labels (Option A)
- The hosted portrait page auto-shows all events when overlay is toggled there (Option B)
- No scope toggle in the overlay HUD (skip Option C for now)

This way: explicit choice in the popup (pick what you want), but no redundant UI on the hosted page (it just naturally shows everything).

---

## Open questions

- [ ] Does the overlay on the portrait page need to know it's "special", or can it just show "all domains" as a fallback when there are no per-domain events for `internet-series`?
- [ ] Button labels: "View page ghost" / "Open portrait"? "Page history" / "My portrait"? Need copy.
- [ ] Should "Open portrait" open a new tab or navigate the current tab?
