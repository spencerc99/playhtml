---
"@playhtml/common": patch
---

Fix can-mirror feedback loops and improve state syncing. Breaks infinite MutationObserver/updateElement loop by disconnecting the observer during remote state application. Moves hover and focus to awareness for ephemeral per-user syncing. Fixes boolean attribute stripping (e.g. details open). Switches to positional child matching to avoid unnecessary DOM destruction. Makes form state sync recursive for nested inputs like radio groups. Adds contenteditable support via input event child syncing. Extracts can-mirror logic into dedicated canMirror.ts file. Adds new can-hover capability for standalone collaborative hover state via awareness.
