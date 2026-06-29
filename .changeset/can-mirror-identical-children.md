---
"@playhtml/common": patch
---

Fix `can-mirror` dropping or corrupting children when an element has multiple identical children or a mix of text and element children.

The child-list sync matched DOM nodes to stored state by value-equality, so repeated children (e.g. several identical images or list items) were deduplicated into a single entry. Removing one child then emptied the lone entry and wiped every child on connected clients. Child-list mutations now resync from the live DOM by position, preserving order and count.

Applying remote state also reconciled children strictly by position, which threw when a position's node kind changed (e.g. a text node lining up against element state after a sibling was removed). Mismatched nodes are now replaced rather than updated in place.

Applying remote state to an element that was emptied remotely now correctly removes its stale children, instead of leaving them in place.
