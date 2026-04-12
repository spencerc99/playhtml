// ABOUTME: Feature flags for the browser extension.
// ABOUTME: Controls visibility of in-development features like copresence.

export const FLAGS = {
  // When false, hide PlayHTML Bag features by default in popup
  // Devs can override via Cmd+Shift+. in the popup
  COPRESENCE: true,
  // Admin video export tool — not linked from any normal extension UI
  // Access via export.html with localStorage.wwo_admin === '1'
  EXPORT_TOOL: false,
} as const;

