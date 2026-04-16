# @playhtml/common

## 0.6.1

### Patch Changes

- a0936aa: Cache `generatePersistentPlayerIdentity()` at the module level so repeated calls return a reference-stable identity. Previously each call re-parsed localStorage, producing a new object with identical data — causing React effect deps and memo comparisons keyed on identity to invalidate on every render. Also fixes two edge cases where corrupt or locked localStorage would cause different identities to be returned across calls in the same session.

## 0.6.0

### Minor Changes

- cd467ce: Add page-level shared data and presence API

  - `playhtml.createPageData(name, default)` for named persistent data channels not tied to DOM elements
  - `playhtml.presence` for unified per-user presence with named channels, `isMe` flag, and channel-scoped `onPresenceChange`
  - Deprecate `playhtml.cursorClient` in favor of `playhtml.presence`

- 6b0964f: Add `playhtml.createPresenceRoom(name)` — creates a domain-scoped presence-only room connection. Returns a `PresenceRoom` with a `PresenceAPI` instance and a `destroy()` cleanup function. Useful for cross-page coordination like lobbies, page directories, and ambient social awareness without cursor rendering overhead.

## 0.5.0

### Minor Changes

- 09768d4: Add can-hover capability for syncing hover state across connected clients via awareness. Style with [data-playhtml-hover] instead of :hover to reflect collaborative hover state.
- 09e380f: Add cursor zones: elements can be registered as zones so that remote cursors are positioned relative to the zone element rather than using absolute viewport coordinates. This enables accurate cursor presence within scrollable containers, embedded editors, and other bounded regions. Adds `CursorZonePosition` type and `zone` field to cursor presence in common, cursor zone registry with zone-relative broadcasting and rendering in the core library, and `useCursorZone` hook with `registerCursorZone`/`unregisterCursorZone` on PlayContext in React.

### Patch Changes

- 09768d4: Fix can-mirror feedback loops and improve state syncing. Breaks infinite MutationObserver/updateElement loop by disconnecting the observer during remote state application. Moves hover and focus to awareness for ephemeral per-user syncing. Fixes boolean attribute stripping (e.g. details open). Switches to positional child matching to avoid unnecessary DOM destruction. Makes form state sync recursive for nested inputs like radio groups. Adds contenteditable support via input event child syncing. Extracts can-mirror logic into dedicated canMirror.ts file.
- 2d16755: Fix room normalization: strip www. prefix so that www.example.com and example.com resolve to the same room. Use "LOCAL" identifier for file:// protocol rooms (empty host) to make them easily identifiable for cleanup. Default cursor coordinate mode changed to absolute so cursors track document position across scroll and zoom.

## 0.4.0

### Minor Changes

- 1427a62: Add cursor presence and stable awareness APIs with improved element awareness scoping

  This release adds new APIs for accessing cursor positions and per-user awareness data keyed by stable user IDs, eliminating the need to access internal providers directly.

  **New Cursor Presence APIs:**

  ```typescript
  // Get all cursor presences (slim shape, keyed by stable ID)
  const presences = playhtml.cursorClient.getCursorPresences();

  // Subscribe to cursor presence changes
  const unsubscribe = playhtml.cursorClient.onCursorPresencesChange(
    (presences) => {
      // presences is Map<string, CursorPresenceView>
    }
  );

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
  };

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

- 3e385c7: Add composable cursor room configuration with filtering and styling options.

## 0.3.1

### Patch Changes

- 8580d25: Fix move bounds.

## 0.3.0

### Minor Changes

- 60666b0: Handle shared elements. Declare a shared element via `shared` attribute, and reference it on other pages / domains via `data-source` attribute. Simple permissioning is supported for read-only and read-write.

### Patch Changes

- 325bfde: Make cursor handling reactive in react package, migrating from `getCursors` -> `cursors` in `PlayContext`.

## 0.2.1

### Patch Changes

- 162cfe9: Add localStorage persistence for cursor names and colors

  Previously, user cursor names and colors were randomly generated on each page visit, creating a confusing experience where users would have different identities across sessions. This update introduces localStorage persistence so users maintain consistent cursor identity.

  **Key Changes:**

  - Added `generatePersistentPlayerIdentity()` function that saves/loads identity from localStorage
  - Enhanced `setColor()` and `setName()` methods to persist changes automatically
  - Added `getCursors()` function to PlayContext for better React integration
  - Updated presence indicator in experiment 7 to show real-time user presence by color

  **Breaking Changes:**
  None - this is backward compatible and enhances the existing experience.

  **Migration:**
  No migration needed. Existing users will get a new persistent identity on their next visit, and from then on it will be preserved across sessions.

## 0.2.0

### Minor Changes

- 639c9b3: Real-time cursor tracking system with proximity detection, chat, and global API
