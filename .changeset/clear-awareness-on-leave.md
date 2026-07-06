---
"playhtml": patch
"@playhtml/react": patch
---

Keep element awareness scoped to the page room, preserve existing local awareness when handlers bind, and clear element awareness snapshots when peers leave so callbacks and views stop seeing stale ephemeral user state. Keep the React package test harness aligned with the configured initialization path.
