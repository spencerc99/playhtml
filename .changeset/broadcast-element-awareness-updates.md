---
"playhtml": patch
---

Fix element awareness (`updateElementAwareness` / `setMyAwareness`) not syncing updates to other clients. The awareness write mutated the current local state object in place, which defeated the y-protocols deep-equality check that decides whether to emit the `change` event — so after the initial value, subsequent updates were applied locally but never broadcast. Element awareness now writes a fresh state object on each update so peers receive every change.
