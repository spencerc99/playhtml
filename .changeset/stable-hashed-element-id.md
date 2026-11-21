---
"playhtml": patch
---

An element with no `id` or `selector-id` now gets one hashed id that stays the same in two cases that used to change it. An element added after the page loads gets the same id as the same markup present at load, and an element with several capabilities (for example `can-toggle can-move`) stores all of them under one id instead of a different one per capability. Data saved under the earlier ids is copied to the element's id the first time it sets up, so saved state carries over. When more than one earlier record exists for a capability, the one saved by a normal page load wins. Data already lost to a markup edit is not recovered, and adding an `id` is still the reliable choice.
