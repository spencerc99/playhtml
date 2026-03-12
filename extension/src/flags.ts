// ABOUTME: Feature flags for the browser extension.
// ABOUTME: Controls visibility of in-development features like copresence.

export const FLAGS = {
  // When false, hide PlayHTML Bag features by default in popup
  // Devs can override via Cmd+Shift+. in the popup
  COPRESENCE: true,
} as const;

