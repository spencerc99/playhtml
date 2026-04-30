---
"playhtml": patch
---

presence: ensure `playerIdentity` is populated on all presence rooms, not only the cursor room. Previously `PresenceView.playerIdentity` was read exclusively from the cursor client's awareness field, so remote peers in any presence room created via `playhtml.createPresenceRoom()` arrived with `playerIdentity: undefined`. Each presence API instance now writes its own identity into a dedicated `__playhtml_identity__` awareness field; `buildViewFromState` falls back to it when the cursor field is absent.
