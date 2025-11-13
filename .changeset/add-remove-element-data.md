---
"@playhtml/react": minor
"playhtml": minor
---

Add `removeElementData` API for cleaning up orphaned element data

This release adds a new `removeElementData(tag, elementId)` function to both the core `playhtml` package and the React wrapper. This function allows you to clean up orphaned data when elements are deleted, preventing accumulation of stale data in the database.

**Usage:**

```tsx
import { removeElementData } from "@playhtml/react";

// Or access via playhtml object
import { playhtml } from "@playhtml/react";
playhtml.removeElementData("can-move", elementId);
```

**What it removes:**
- SyncedStore data
- Observer subscriptions  
- Element handlers
- Legacy globalData entries (if applicable)
- Shared reference tracking

This is especially useful for tags like `can-move` that store per-element state, where deleted elements can leave orphaned data behind.



