# Change Log

## 0.8.0

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
    },
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
- 7cc91bd: Add `deleteElementData` API for cleaning up orphaned element data

  This release adds a new `deleteElementData(tag, elementId)` function to both the core `playhtml` package and the React wrapper. This function allows you to clean up orphaned data when elements are deleted, preventing accumulation of stale data in the database.

  **Usage:**

  ```tsx
  import { deleteElementData } from "@playhtml/react";

  // Or access via playhtml object
  import { playhtml } from "@playhtml/react";
  playhtml.deleteElementData("can-move", elementId);
  ```

### Patch Changes

- Updated dependencies [1427a62]
- Updated dependencies [3e385c7]
- Updated dependencies [7cc91bd]
  - playhtml@2.6.0
  - @playhtml/common@0.4.0

## 0.7.0

### Minor Changes

- 60666b0: Handle shared elements. Declare a shared element via `shared` attribute, and reference it on other pages / domains via `data-source` attribute. Simple permissioning is supported for read-only and read-write.

### Patch Changes

- 325bfde: Make cursor handling reactive in react package, migrating from `getCursors` -> `cursors` in `PlayContext`.
- Updated dependencies [325bfde]
- Updated dependencies [60666b0]
  - playhtml@2.5.0
  - @playhtml/common@0.3.0

## 0.6.1

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

- Updated dependencies [162cfe9]
- Updated dependencies [09298ae]
  - @playhtml/common@0.2.1
  - playhtml@2.4.1

## 0.6.0

### Minor Changes

- 335af8b: Add dynamic cursor configuration API, fix visibility threshold, and add custom cursor renderer.
- 335af8b: Add `getMyPlayerIdentity` method to PlayContext for accessing current user's color and name information from the cursor system

### Patch Changes

- aa19771: Fix JSX component type error in withSharedState. Changed component return type from ReactElement to ReactNode and withSharedState return type to React.ComponentType for proper JSX compatibility.
- Updated dependencies [335af8b]
  - playhtml@2.4.0

## 0.5.2

### Patch Changes

- Updated dependencies [639c9b3]
  - playhtml@2.3.0
  - @playhtml/common@0.2.0

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## 0.5.1 - 2025-08-25

### Added

- `LoadingOptions` interface for configuring loading states in React components
- New `usePlayContext` hook to easily access PlayContext

### Changed

- Updated to playhtml 2.2.1 with improved loading state support

## 0.5.0 - 2025-08-19

### Added

- Enhanced mutator form support for `setData`: `setData(draft => { ... })` now fully supported with improved CRDT collaboration
- Inherited SyncedStore-backed nested CRDT support from playhtml core for automatic conflict resolution

### Changed

- Updated to playhtml 2.2.0 with improved CRDT array operations
- Updated to @playhtml/common 0.1.0 with enhanced type definitions

## 0.4.1 - 2025-04-14

### Breaking Changes

- **REMOVED API** Completely removed the deprecated `withPlay` function. Use `withSharedState` instead (see migration guide in 0.3.1 release notes below).

### Enhancements

- **ENHANCEMENT** Added support for React 19
- Updated peerDependencies to include React 19
- Updated TypeScript definitions to support React 19
- Improvements to provider detection & handling island architectures like Astro
  - Added standalone mode functionality to eliminate the requirement for a PlayProvider wrapper
  - Enhanced provider detection with clearer error messages when a provider is missing

## 0.3.1 - 2024-02-17

- **NEW API** Replaced the main api `withPlay` with `withSharedState` to make it more functionally clear what it does. This new API also is much cleaner because it removes the need to curry the function. The old `withPlay` API is still available for backwards compatibility but will be removed in the next major version. See some examples below for the comparison:

**old api**

```tsx
export const ToggleSquare = withPlay<Props>()(
  { defaultData: { on: false } },
  ({ data, setData, ...props }) => {
    return (
      <div
        style={{
          width: "200px",
          height: "200px",
          ...(data.on ? { background: "green" } : { background: "red" }),
        }}
        onClick={() => setData({ on: !data.on })}
      />
    );
  },
);
```

**new api**

```tsx
export const ToggleSquare = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }, props: Props) => {
    return (
      <div
        style={{
          width: "200px",
          height: "200px",
          ...(data.on ? { background: "green" } : { background: "red" }),
        }}
        onClick={() => setData({ on: !data.on })}
      />
    );
  },
);
```

## 0.2.0 - 2024-01-27

- **NEW FEATURE** Added eventing support for imperative logic like showing confetti whenever someone clicks a button which don't depend on a reacting to a data value changing. See the README under "eventing" for more details on how to set this up.`

## 0.1.0

- works with more complex state
- allows for setting data inside your render function
- passes ref into render function for accessing the component information / imperatively acting on it
- handles passing in fragments and multiple children into render function
- works with Next.JS and examples

## 0.0.12 - 2023-09-11

- works when changing props

## 0.0.11 - 2023-09-11

- ok confirmed working now and handles unmount

## 0.0.2 - 2023-09-07

- basic react support!
