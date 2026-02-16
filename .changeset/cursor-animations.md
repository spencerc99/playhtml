---
"playhtml": minor
"@playhtml/react": minor
---

Add cursor animation API: `triggerCursorAnimation(stableId, animationClass, durationMs)` applies a CSS class to a cursor element for a given duration. Includes self-cursor support via a temporary ghost cursor element, animation stacking prevention, and guards to prevent position/visibility updates from interfering with active animations. Also improves coordinate conversion to account for browser zoom via visualViewport.
