// ABOUTME: Developer-only debug overlays that the popup can switch on for every open page.
// ABOUTME: Each mode is one boolean in extension storage, read by the content script.

export const DEV_MODE_KEY = "dev_mode";

export interface DebugMode {
  id: string;
  storageKey: string;
  label: string;
  description: string;
}

export const SCRAPS_DEBUG_KEY = "debug_scraps_overlay";

export const DEBUG_MODES: readonly DebugMode[] = [
  {
    id: "scraps",
    storageKey: SCRAPS_DEBUG_KEY,
    label: "scraps overlay",
    description: "outline each image with why it was kept or skipped",
  },
];
