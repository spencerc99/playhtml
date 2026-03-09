---
"@playhtml/common": minor
"playhtml": minor
"@playhtml/react": minor
---

Add cursor zones: elements can be registered as zones so that remote cursors are positioned relative to the zone element rather than using absolute viewport coordinates. This enables accurate cursor presence within scrollable containers, embedded editors, and other bounded regions. Adds `CursorZonePosition` type and `zone` field to cursor presence in common, cursor zone registry with zone-relative broadcasting and rendering in the core library, and `useCursorZone` hook with `registerCursorZone`/`unregisterCursorZone` on PlayContext in React.
