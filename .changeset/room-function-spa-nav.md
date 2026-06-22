---
"playhtml": minor
---

`init`'s `room` option now accepts a function (`() => string`), not just a
string. A function room is re-invoked on every SPA navigation, so a
path-derived room follows the URL the same way the default room does; a static
string still stays fixed for the page's lifetime.

On a room change during SPA navigation, the Yjs doc is now re-initialized so
the new room starts clean — page data AND element data reset to the new room,
the same as a full page reload. Previously the doc was reused across rooms, so a
previous room's data bled into the next one. The doc is discarded and recreated
(not deleted from), so no delete tombstone syncs back and destroys the original
room's persisted data on a round trip. Same-room navigation (hash changes, a
static explicit room, unchanged path) does not reset — data persists across the
route change as before.
