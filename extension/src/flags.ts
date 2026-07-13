// ABOUTME: Feature flags for the browser extension.
// ABOUTME: Controls visibility of in-development features like copresence.

export const FLAGS = {
  // When false, hide PlayHTML Bag features by default in popup
  // Devs can override via Cmd+Shift+. in the popup
  COPRESENCE: true,

  // Social experiments — each runs on every page via the social registry
  // (src/features/social/registry.ts). Default OFF for normal users; devs who
  // have toggled `internalDevFeaturesEnabled` (Cmd+Shift+. in the popup) see
  // every experiment regardless of these flags. Flip one to `true` only when
  // it's ready to ship to everyone (with its own safety layers).
  BOTTLES: false,
  SCISSORS: false,
  QUARANTINE_TAPE: false,

  // Inventory surface (the satchel) + the InventoryAPI. Gates the on-page UI.
  INVENTORY: true,
} as const;
