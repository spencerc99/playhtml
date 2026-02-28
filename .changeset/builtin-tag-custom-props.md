---
"playhtml": patch
"@playhtml/react": patch
---

Fix built-in tag types (can-move, can-spin, etc.) ignoring custom properties set via withSharedState. Previously, only can-play elements read custom defaultData, onDrag, and other overrides from the DOM element. Now built-in tag initializers are merged with any custom properties, allowing withSharedState users to override defaultData and handlers for built-in capabilities. Also fix React setData/setMyAwareness callbacks to look up element handlers by actual tag instead of hardcoding can-play.
