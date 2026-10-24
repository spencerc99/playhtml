---
"playhtml": patch
---

The cursor client can now tell you whose cursor is drawn at a point on screen (`getCursorIdAt(x, y, slop)`). Other people's cursors ignore pointer events, so this lets a tap or click pick a person, for example to open a menu next to their cursor on a phone.
