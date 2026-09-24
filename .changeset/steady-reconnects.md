---
"playhtml": patch
---

Reconnects are steadier. After a room is reset, a reconnecting page now always sends the room's latest reset marker, even when the browser blocks localStorage, and a fresh page that joins with an older marker stays connected instead of reloading its room. Presence reconnects are spread out over a few seconds after a server restart, and other people's cursors stay put through a brief reconnect instead of fading out and back in.
