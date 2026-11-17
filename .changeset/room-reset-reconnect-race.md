---
"playhtml": patch
---

Fix a room reset (an admin hard reset or compaction) getting undone right away. When the server reset a room, the old connection could reconnect on its own with the page's pre-reset copy of the room before playhtml swapped in a fresh one, which merged all the deleted history back into the room and stopped it from saving. playhtml now drops the old connection before it records the new reset.
