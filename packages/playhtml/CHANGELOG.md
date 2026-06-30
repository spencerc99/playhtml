# Change Log

## 2.11.2

### Patch Changes

- 95ace2b: Keep the React bindings connected to the app-provided playhtml runtime so package managers do not install a separate nested playhtml client for React wrappers, and expose the shared React-facing API through playhtml so React consumers only depend on one compatibility boundary.

## 2.11.1

### Patch Changes

- 22dae41: Move cursor motion onto PlayHTML's realtime presence transport, add shared protocol validation for presence messages, coalesce pointer work per animation frame, adapt cursor publish rates as active room load grows, expire stale cursor positions, and keep cursor movement out of persistent shared data.
- d7ffb66: `can-duplicate` and `can-duplicate-to` now accept an element id, an id with a leading `#`, or any CSS selector — the same resolution `can-move-bounds` already used. Previously `can-duplicate="#my-template"` silently failed because the value was passed straight to `getElementById`. Clone ids are now derived from the resolved template element's own id, so a selector or `#`-prefixed value still produces valid clone ids.
- Updated dependencies [22dae41]
- Updated dependencies [18d2891]
- Updated dependencies [d7ffb66]
  - @playhtml/common@0.7.2

## 2.11.0

### Minor Changes

- 60ccf22: `init`'s `room` option now accepts a function (`() => string`), not just a
  string. A function room is re-invoked on every SPA navigation, so a
  path-derived room follows the URL the same way the default room does; a static
  string still stays fixed for the page's lifetime.

  On a room change during SPA navigation, the Yjs doc is now re-initialized so
  the new room starts clean — page data AND element data reset to the new room,
  the same as a full page reload. Previously the doc was reused across rooms, so a
  previous room's data bled into the next one. The doc is discarded and recreated
  (not deleted from), so no delete tombstone syncs back and destroys the original
  room's persisted data on a round trip. Same-room navigation (hash changes, a
  static explicit room, unchanged path) does not reset — data persists across the
  route change as before.

### Patch Changes

- 60ccf22: Allow passing a function-valued `room` so `handleNavigation()` can recompute it on route changes.
- 8b0e546: Handle server room-reset messages by reconnecting the current room in place before falling back to a page reload, so admin data restores can update connected clients with less visible disruption.
- Updated dependencies [9df0417]
  - @playhtml/common@0.7.1

## 2.10.1

### Patch Changes

- 3414751: `cursorClient.configure({ playerIdentity })` now emits `color` and `name` events when the identity's color or name changes, mirroring the `window.cursors` setters. This makes identity injected through `configure()` — including the extension's `playhtml:configure-identity` bridge — reactively update subscribers (e.g. the React context behind `usePlayerIdentity()`), instead of silently changing only the internal state.
- 0a155a3: Report duplicate playhtml element IDs during registration and surface duplicate ID groups in the development UI so developers can find shared-data collisions.
- 10d5683: Fix local element cleanup and React registration stability so remounted playhtml elements can register replacement handlers without keeping stale drag state.
- 7f6e3de: Fix `playhtml.presence.getPresences()` collapsing multi-tab awareness entries non-deterministically. When a user has the site open in multiple tabs, all tabs share one publicKey (stableId) but have distinct clientIDs. The previous implementation overwrote in iteration order, so a backgrounded tab's `active: false` could clobber the foreground tab's `active: true` in the consumer's view. Self now always reflects the local tab's state; remote peers with multiple tabs are collapsed deterministically (highest clientID wins).
- 9f33c3c: `presence.onPresenceChange` now replays the current presence snapshot to the callback immediately on subscribe, instead of waiting for the next awareness change. Late subscribers previously missed state that peers had already broadcast — for example, a peer who set a presence field before you joined the room would stay invisible to your listener until they changed it again.
- 251b41d: Expose `playhtml.syncedStore` as a read-only inspection view so browser scripts cannot mutate shared element data directly. Element updates still go through playhtml's normal `setData()` path, while administrative data edits remain handled by the admin console.

## 2.10.0

### Minor Changes

- 278e7d2: `can-move` now supports a declarative `can-move-bounds` attribute that clamps a draggable element to a specific container. Set the value to the container's id (`can-move-bounds="arena"` or `can-move-bounds="#arena"`) or any CSS selector. The element can partially hang off the container edges — by default `max(25% of element size, 60px)` stays inside on every edge so readers always have something to grab — while the cursor itself is unconstrained and a fast drag past the edge won't fling the element back in the opposite direction.

  Tune the keep-visible slice with two optional attributes:
  - `can-move-bounds-min-visible` (0–1) — fraction of the element to keep visible. Use `1` to pin fully inside (legacy strict clamp), `0` to drop the fraction constraint.
  - `can-move-bounds-min-visible-px` (pixels, default 60) — absolute floor, useful when an image has transparent padding that would otherwise let the visible paint slip out. The effective slice is `max(fraction × size, pxFloor)`.

  Set both to `0` to opt fully out of the keep-visible guarantee.

  ```html
  <div id="fridge">
    <div can-move can-move-bounds="fridge" id="magnet-a">🍎</div>
    <div
      can-move
      can-move-bounds="#fridge"
      can-move-bounds-min-visible="0.5"
      can-move-bounds-min-visible-px="0"
      id="magnet-b"
    >
      🥐
    </div>
  </div>
  ```

  In React, `<CanMoveElement>` gets typed `bounds`, `boundsMinVisible`, and `boundsMinVisiblePx` props that map to the same attributes:

  ```tsx
  import { CanMoveElement } from "@playhtml/react";

  <CanMoveElement bounds="fridge" boundsMinVisible={0.5} boundsMinVisiblePx={0}>
    <div id="magnet">🧲</div>
  </CanMoveElement>;
  ```

  Exported from `@playhtml/common`: `CanMoveBounds`, `CanMoveBoundsMinVisible`, `CanMoveBoundsMinVisiblePx`.

- 4803cc5: Add `playhtml.ready` and `playhtml.isLoading` as public lifecycle signals. Concurrent `playhtml.init()` calls now share the same readiness promise, so multiple React roots can safely mount providers without one root marking itself ready before the singleton has finished syncing.

  `<PlayProvider>` still bootstraps playhtml when rendered with or without `initOptions`, preserving the existing bare-provider behavior while using the shared readiness signal for React context loading state.

- 234d732: SPA navigation compatibility. playhtml now detects client-side navigation (Astro ViewTransitions, React Router, Next.js, htmx boost, Turbo) via the browser's Navigation API and `popstate`, rebuilding rooms and rescanning the DOM as URLs change.

  New public API:
  - `playhtml.handleNavigation()` — manual trigger for routers that bypass both Navigation API and `popstate`.
  - `CursorOptions.container` accepts `HTMLElement | string | (() => HTMLElement | null)` — cursor DOM and styles mount inside this element, so marking it with `transition:persist` (or equivalent) keeps cursors across body-swaps.
  - `<PlayProvider>` accepts a `pathname` prop that calls `playhtml.handleNavigation()` when it changes, and a `RefObject` for `cursors.container`.
  - `playhtml:navigated` CustomEvent fires on `document` after each navigation, with `detail.room`.

  See https://playhtml.fun/docs/advanced/navigation/ for framework-specific usage.

### Patch Changes

- c8d1f9b: Cursors now anchor to content when the cursor `container` has its own CSS transform (e.g. a pannable, zoomable canvas). The library reads the live transform matrix from `getComputedStyle()` and stores cursor coordinates in the container's local coordinate space, so two clients with different pan/zoom agree on a cursor's content position; each viewer's CSS transform then maps that position to their own viewport pixels. Default behavior is unchanged when `container` is `document.body` (no transform → identity matrix).
- 07747ee: Update the y-partyserver provider dependency used by playhtml.
- 43d1353: presence: ensure `playerIdentity` is populated on all presence rooms, not only the cursor room. Previously `PresenceView.playerIdentity` was read exclusively from the cursor client's awareness field, so remote peers in any presence room created via `playhtml.createPresenceRoom()` arrived with `playerIdentity: undefined`. Each presence API instance now writes its own identity into a dedicated `__playhtml_identity__` awareness field; `buildViewFromState` falls back to it when the cursor field is absent.
- Updated dependencies [278e7d2]
- Updated dependencies [a0936aa]
  - @playhtml/common@0.7.0

## 2.9.0

### Minor Changes

- cd467ce: Add page-level shared data and presence API
  - `playhtml.createPageData(name, default)` for named persistent data channels not tied to DOM elements
  - `playhtml.presence` for unified per-user presence with named channels, `isMe` flag, and channel-scoped `onPresenceChange`
  - Deprecate `playhtml.cursorClient` in favor of `playhtml.presence`

- 6b0964f: Add `playhtml.createPresenceRoom(name)` — creates a domain-scoped presence-only room connection. Returns a `PresenceRoom` with a `PresenceAPI` instance and a `destroy()` cleanup function. Useful for cross-page coordination like lobbies, page directories, and ambient social awareness without cursor rendering overhead.

### Patch Changes

- bdfa16f: Fix phantom duplicate cursors when same user has multiple tabs open on the same URL. Cursors are now deduplicated by publicKey instead of Yjs clientId. Also fixes scroll lag for inactive cursors by switching absolute-mode cursors to position:absolute (browser-native scroll compositing) and replacing the 150ms scroll debounce with requestAnimationFrame throttle.
- Updated dependencies [cd467ce]
- Updated dependencies [6b0964f]
  - @playhtml/common@0.6.0

## 2.8.0

### Minor Changes

- 09e380f: Add cursor zones: elements can be registered as zones so that remote cursors are positioned relative to the zone element rather than using absolute viewport coordinates. This enables accurate cursor presence within scrollable containers, embedded editors, and other bounded regions. Adds `CursorZonePosition` type and `zone` field to cursor presence in common, cursor zone registry with zone-relative broadcasting and rendering in the core library, and `useCursorZone` hook with `registerCursorZone`/`unregisterCursorZone` on PlayContext in React.

### Patch Changes

- b7fc2e6: Fix built-in tag types (can-move, can-spin, etc.) ignoring custom properties set via withSharedState. Previously, only can-play elements read custom defaultData, onDrag, and other overrides from the DOM element. Now built-in tag initializers are merged with any custom properties, allowing withSharedState users to override defaultData and handlers for built-in capabilities. Also fix React setData/setMyAwareness callbacks to look up element handlers by actual tag instead of hardcoding can-play.
- 2d16755: Fix room normalization: strip www. prefix so that www.example.com and example.com resolve to the same room. Use "LOCAL" identifier for file:// protocol rooms (empty host) to make them easily identifiable for cleanup. Default cursor coordinate mode changed to absolute so cursors track document position across scroll and zoom.
- Updated dependencies [09768d4]
- Updated dependencies [09768d4]
- Updated dependencies [09e380f]
- Updated dependencies [2d16755]
  - @playhtml/common@0.5.0

## 2.7.0

### Minor Changes

- 90fa88a: Add cursor animation API: `triggerCursorAnimation(stableId, animationClass, durationMs)` applies a CSS class to a cursor element for a given duration. Includes self-cursor support via a temporary ghost cursor element, animation stacking prevention, and guards to prevent position/visibility updates from interfering with active animations. Also improves coordinate conversion to account for browser zoom via visualViewport.

## 2.6.0

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
  - @playhtml/common@0.4.0

## 2.5.1

### Patch Changes

- Updated dependencies [8580d25]
  - @playhtml/common@0.3.1

## 2.5.0

### Minor Changes

- 60666b0: Handle shared elements. Declare a shared element via `shared` attribute, and reference it on other pages / domains via `data-source` attribute. Simple permissioning is supported for read-only and read-write.

### Patch Changes

- 325bfde: Make cursor handling reactive in react package, migrating from `getCursors` -> `cursors` in `PlayContext`.
- Updated dependencies [325bfde]
- Updated dependencies [60666b0]
  - @playhtml/common@0.3.0

## 2.4.1

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

- 09298ae: Remove unused y-indexeddb dependency
- Updated dependencies [162cfe9]
  - @playhtml/common@0.2.1

## 2.4.0

### Minor Changes

- 335af8b: Add dynamic cursor configuration API, fix visibility threshold, and add custom cursor renderer.

## 2.3.0

### Minor Changes

- 639c9b3: Real-time cursor tracking system with proximity detection, chat, and global API

### Patch Changes

- Updated dependencies [639c9b3]
  - @playhtml/common@0.2.0

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## 2.2.1 - 2025-08-25

### Added

- Default loading states for all playhtml elements while waiting for initial sync
- Loading style options: `breathing` (default), `pulse`, `fade`, `none`
- Custom loading class support via `loading-class` attribute
- `can-play` elements default to no loading state for maximum customization flexibility

### Changed

- Elements are now visually disabled (`pointer-events: none`) during loading state
- Improved initial page load experience with consistent loading feedback

## 2.2.0 - 2025-08-19

### Added

- SyncedStore-backed nested CRDT support by default (dataMode = "syncedstore"), enabling automatic conflict resolution for arrays/objects under `data`.
- Mutator form for `setData`: `setData(draft => { ... })` now supported across core and React wrappers, providing merge-friendly edits to nested structures.
- Replacement semantics for `setData(value)` clarified and enforced for canonical snapshot updates (e.g., can-mirror).

## 2.1.6 - 2024-04-17

- fix bug with native image dragging conflicting with playhtml draggable elements.

## 2.1.2 - 2024-01-30

- align dependencies

## 2.1.1 - 2024-01-30

- added an `init.js` file export which can be imported to auto-initialize with default settings. Designed to be simplest way to get started with playhtml.

## 2.1.0 - 2024-01-27

- **NEW FEATURE** Added eventing support for imperative logic like showing confetti whenever someone clicks a button which don't depend on a reacting to a data value changing. See the README under "eventing" for more details on how to set this up.
- **BREAKING CHANGE** Changed the hash function used to generate element ids to be a stable length for long-term scalability. This will cause all elements without an `id` to be re-created to lose any persistent historical data. This was done to avoid duplicates and to swap to using a standard-length hash function (SHA-1). We still recommend you setting a unique `id` for each element to avoid any potential duplicates in the future, and using `selectorId` will not be affected by this change.

## 2.0.16 - 2024-01-04

- **BREAKING CHANGE** deprecated using non-object values as `defaultData` for elements. If you were using a single value before, instead, use an object with a `value` key. e.g. `defaultData: { value: "my value" }`. This allows for easier extension of the data in the future.
- **BREAKING CHANGE** deprecated `playhtml.init()` automatically being called to avoid side-effects upon import. This has been replaced with a new `init` file that you can directly import if you'd like to auto-initialize without any settings. See the README for more details.
- exported `setupPlayElements` to call to look for any new elements to initialize

## 2.0.7 - 2023-10-02

- upgrading y-partykit and yjs to latest for improved performance

## 2.0.5 - 2023-09-11

- fixed an error with setting up elements before the provider was synced which lead to incorrect initial element states that didn't sync.
- Removed the `firstSetup` export accordingly to allow for optimistically setting up elements even before `playhtml` is initialized.
- Added `removePlayElement` to handle removing upon unmounting or removal of an element from the DOM to clear up the state.

## 2.0.4 - 2023-09-07

- added @playhtml/react library
- added `firstSetup` export from playhtml for raising error if it hasn't been initialized.
- cleaned up exports

## 2.0.2 - 2023-08-23

- handle deprecated import version by using a timeout. This adds a significant delay to the initialization of any client using the old method and logs a warning.

## 2.0.0 - 2023-08-23

- **BREAKING CHANGE**: Changed the initializing of playhtml to be an explicit call of `playhtml.init()` from just a normal import. You can still use the old code if you pin the import to any version 1.3.1 (e.g. use `https://unpkg.com/playhtml@1.3.1` as the import source).

**OLD CODE:**

```html
<script type="module" src="https://unpkg.com/playhtml"></script>
<link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
```

**NEW CODE:**

```html
<script type="module">
  import "https://unpkg.com/playhtml";
  playhtml.init();
  // Optionally you could call
  // playhtml.init({
  //  room: window.location.pathname,
  //  host: "mypartykit.user.partykit.dev"
  // })
</script>
<link rel="stylesheet" href="https://unpkg.com/playhtml/dist/style.css" />
```

This change allows for more flexible use of the package, including specifying a partykit host and room.

- was accidentally importing all my files for the website into the package, blowing it up to 4MB. I've fixed this and compressed down the `.d.ts` types file to just what is needed, so the package is down to 360KB. It should load much faster on websites now :)

## 1.3.1 - 2023-08-09

- Removed unused code and consolidated types in `types.ts`

## 1.3.0 - 2023-08-07

- Added support for `can-duplicate` capability to duplicate elements. Make factories for playhtml elements!!

## 1.2.0 - 2023-08-03

- Added support for yjs's `awareness` protocol to handle synced data that shouldn't be persisted.
