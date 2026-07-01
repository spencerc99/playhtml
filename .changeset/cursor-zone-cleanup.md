---
"@playhtml/react": patch
---

Fix `useCursorZone` so cleanup unregisters the originally registered zone id and option changes re-register the zone.
