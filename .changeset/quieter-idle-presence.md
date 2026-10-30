---
"playhtml": patch
---

Idle and background tabs send far less presence traffic. A tab now re-announces its presence once a minute instead of every 10 seconds, and stops while it is hidden, so a page nobody is actively using can go quiet. A hidden tab drops out of other people's presence after about two and a half minutes and reappears when it becomes visible. Cursor positions are no longer sent while nobody else is in the room; your cursor is sent as soon as someone joins.
