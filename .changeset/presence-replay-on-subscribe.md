---
"playhtml": patch
---

`presence.onPresenceChange` now replays the current presence snapshot to the callback immediately on subscribe, instead of waiting for the next awareness change. Late subscribers previously missed state that peers had already broadcast — for example, a peer who set a presence field before you joined the room would stay invisible to your listener until they changed it again.
