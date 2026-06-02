---
"playhtml": patch
---

Fix `playhtml.presence.getPresences()` collapsing multi-tab awareness entries non-deterministically. When a user has the site open in multiple tabs, all tabs share one publicKey (stableId) but have distinct clientIDs. The previous implementation overwrote in iteration order, so a backgrounded tab's `active: false` could clobber the foreground tab's `active: true` in the consumer's view. Self now always reflects the local tab's state; remote peers with multiple tabs are collapsed deterministically (highest clientID wins).
