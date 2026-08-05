---
"@playhtml/react": patch
---

Keep `usePresenceRoom()` returning `null` instead of throwing when React renders ahead of PlayHTML readiness during navigation or provider remount timing.
