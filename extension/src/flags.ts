// ABOUTME: Feature flags for the browser extension.
// ABOUTME: Controls released and experimental extension capabilities.

export const FLAGS = {
  // Shared cursor presence and the popup's presence count.
  COPRESENCE: true,

  // Social experiments — each runs on every page via the social registry
  // (src/features/social/registry.ts). Default OFF for normal users; devs who
  // have toggled `internalDevFeaturesEnabled` (Cmd+Shift+. in the popup) see
  // every experiment regardless of these flags. Flip one to `true` only when
  // it's ready to ship to everyone (with its own safety layers).
  BOTTLES: false,
  SCISSORS: false,
  HAMMER: false,
  QUARANTINE_TAPE: false,

  // Inventory surface (the satchel) + the InventoryAPI. Gates the on-page UI.
  INVENTORY: true,

  // Internet scraps: passive collection of distinctive images seen while
  // browsing, rendered as a scatter-collage (scraps.html). Local-only data.
  SCRAPS: false,

  // Settings for PlayHTML Bag features that are not ready for general use.
  BAG_SETTINGS: false,

  // Internet Commute: full-tab slow browsing train populated from recent
  // extension navigation events.
  COMMUTE: false,
} as const;
