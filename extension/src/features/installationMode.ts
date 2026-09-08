// ABOUTME: Names the local installation cursor preference shared by settings, pages, and collectors.
// ABOUTME: Installation mode is opt-in, persists in this browser profile, and paces collection for live screens.

import browser from "webextension-polyfill";

export const INSTALLATION_MODE_KEY = "wwoInstallationMode";
/** Mute switch for the installation frame's live sound. Unset means on. */
export const INSTALLATION_SOUND_KEY = "wwoInstallationSound";

/**
 * Installation pace. Ordinary browsing samples sparsely to stay cheap; an
 * installation machine trades that headroom for screens that read as live, so
 * cursor samples and both buffer hops run several times faster.
 */
export const INSTALLATION_PACE = {
  cursorSampleRateMs: 80,
  cursorMovementThresholdPx: 4,
  storeBatchIntervalMs: 200,
  uploadBatchIntervalMs: 500,
} as const;

export async function isInstallationModeEnabled(): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(INSTALLATION_MODE_KEY);
    return stored[INSTALLATION_MODE_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Calls back with installation mode now and on every later change. Returns an
 * unsubscribe function.
 */
export function watchInstallationMode(
  listener: (enabled: boolean) => void,
): () => void {
  let stopped = false;
  const onChanged = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string,
  ) => {
    if (stopped || area !== "local" || !changes[INSTALLATION_MODE_KEY]) return;
    listener(changes[INSTALLATION_MODE_KEY].newValue === true);
  };

  browser.storage.onChanged.addListener(onChanged);
  void isInstallationModeEnabled().then((enabled) => {
    if (!stopped) listener(enabled);
  });

  return () => {
    stopped = true;
    browser.storage.onChanged.removeListener(onChanged);
  };
}
