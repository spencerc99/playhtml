# @playhtml/common

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
