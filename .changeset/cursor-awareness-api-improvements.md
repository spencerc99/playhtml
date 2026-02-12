---
"playhtml": minor
"@playhtml/common": minor
"@playhtml/react": minor
---

Add cursor presence and stable awareness APIs with improved element awareness scoping

This release adds new APIs for accessing cursor positions and per-user awareness data keyed by stable user IDs, eliminating the need to access internal providers directly.

**New Cursor Presence APIs:**

```typescript
// Get all cursor presences (slim shape, keyed by stable ID)
const presences = playhtml.cursorClient.getCursorPresences();

// Subscribe to cursor presence changes
const unsubscribe = playhtml.cursorClient.onCursorPresencesChange((presences) => {
  // presences is Map<string, CursorPresenceView>
});

// Get my stable player identity
const identity = playhtml.cursorClient.getMyPlayerIdentity();
const stableId = identity.publicKey; // Persists across sessions
```

**New Awareness API - awarenessByStableId:**

Element awareness is now provided keyed by stable user ID in addition to the array format:

```typescript
// Core playhtml
updateElementAwareness: ({ awareness, awarenessByStableId }) => {
  const userDrunkLevel = awarenessByStableId.get(stableId)?.drunkLevel;
}

// React withSharedState
withSharedState(({ data, awareness, awarenessByStableId, myAwareness }) => {
  const userDrunkLevel = awarenessByStableId.get(stableId)?.drunkLevel;
  // ...
});
```

**New React Hook:**

```typescript
import { useCursorPresences } from "@playhtml/react";

function MyComponent() {
  const cursorPresences = useCursorPresences();
  // Map<string, CursorPresenceView> keyed by stable ID
}
```

**Breaking Change - Awareness Scope:**

Element awareness now follows cursor scope instead of always being page-specific:
- If cursors are configured with `room: "domain"`, element awareness is domain-wide
- If cursors are configured with `room: "page"`, element awareness is page-specific
- If cursors are configured with `room: "section"`, element awareness is section-specific

This is more intuitive (your user state follows you) but may affect apps that relied on the old behavior. To restore page-specific awareness when cursors are domain-wide, you can configure cursors to use page scope separately.

**Benefits:**

- Stable user IDs (`playerIdentity.publicKey`) persist across page refreshes
- No need to access `(playhtml.cursorClient as any).provider` - use clean public APIs
- Easier to correlate cursor positions with user-specific awareness data
- Awareness scope matches cursor scope for more intuitive behavior
