---
"@playhtml/react": minor
"playhtml": minor
---

Add dynamic cursor configuration API and fix visibility threshold

Adds `configureCursors` method to PlayContext that allows components to dynamically configure cursor system settings including proximity handlers, thresholds, and other cursor options. This provides a cleaner React API compared to manually setting cursor system properties.

Also fixes the visibility threshold functionality which was previously not working correctly. Cursors outside the visibility threshold are now properly hidden using `display: none` and visibility updates occur in real-time as the user's cursor moves.
