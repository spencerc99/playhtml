---
"@playhtml/react": patch
---

Fix `CanDuplicateElement` so it actually clones. It previously registered under
`can-play` and never set the `can-duplicate` attribute, so the capability's
`onClick` had no template id to build clone ids from and no clone was ever
inserted. The component now stamps both `can-duplicate` (pointing at the
`elementToDuplicate` element's id) and `can-duplicate-to` (the `canDuplicateTo`
container's id) as real DOM attributes, gives the trigger a stable id so its
handler isn't re-keyed on every render, and lets the built-in capability handle
the duplication. Clones now appear on click, persist across reloads, and sync
across tabs.

Also fix an infinite render loop in `CanPlayElement`: it pushed every synced
value into React state unconditionally, but capability data can arrive as a
fresh reference for unchanged data (e.g. a Yjs collection snapshot), so React
never bailed and the setup effect re-ran forever. Synced state is now compared
by value and only applied when it actually changed, which is what made
`CanDuplicateElement`'s array data loop.
