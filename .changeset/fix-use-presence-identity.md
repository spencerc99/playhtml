---
"@playhtml/react": patch
---

Fix `usePresence().myIdentity` freezing at sync completion and never reflecting a later identity change (e.g. the "we were online" extension injecting identity post-sync). It now updates reactively, mirroring `usePlayerIdentity`.
