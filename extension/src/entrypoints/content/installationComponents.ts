// ABOUTME: Starts the installation frame and local cursor when installation mode is enabled.
// ABOUTME: Owns their paired cleanup for mode changes and content-script invalidation.

import { initInstallationCursor } from "./installationCursor";
import { initInstallationFrame } from "./installationFrame";

export function initInstallationComponents(): () => void {
  const removeFrame = initInstallationFrame();
  let removeCursor: () => void;
  try {
    removeCursor = initInstallationCursor();
  } catch (error) {
    removeFrame();
    throw error;
  }
  return () => {
    removeCursor();
    removeFrame();
  };
}
