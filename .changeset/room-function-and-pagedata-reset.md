---
"playhtml": minor
---

`init`'s `room` option now accepts a function (`() => string`), not just a
string. A function room is re-invoked on every SPA navigation, so a
path-derived room follows the URL the same way the default room does; a static
string still stays fixed for the page's lifetime.

Page data is now reset on room change. The Yjs doc is reused across room
rebuilds, so previously a room's `createPageData` channels could carry their
contents into the next room on navigation (and sync them there). Page-data
channels now clear when the main room changes, so each room starts clean from
its default. A channel handle held across the route change stays usable —
`setData` re-acquires its proxy instead of throwing, and a stale handle's
`destroy` no longer tears down a channel reopened in the new room.
