---
"playhtml": patch
---

Handle server room-reset messages by reconnecting the current room in place before falling back to a page reload, so admin data restores can update connected clients with less visible disruption.
