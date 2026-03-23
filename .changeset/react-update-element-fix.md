---
"@playhtml/react": patch
---

Fix React can-* elements (CanMove, CanSpin, CanGrow, CanToggle) not applying visual updates. The built-in capability's updateElement (which applies CSS transforms, class toggles, etc.) was being overwritten by the React state updater instead of composed with it.
