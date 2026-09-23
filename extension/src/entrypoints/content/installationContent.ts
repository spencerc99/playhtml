// ABOUTME: Watches installation mode on ordinary pages and loads its visual components when enabled.
// ABOUTME: Removes the cursor and frame when the mode turns off or the content script ends.

import browser from "webextension-polyfill";
import { INSTALLATION_MODE_KEY } from "../../features/installationMode";

export function watchInstallationContent(): () => void {
  let disposed = false;
  let enabled = false;
  let revision = 0;
  let removeContent: (() => void) | null = null;
  let loading: Promise<void> | null = null;
  let startContent: (() => () => void) | null = null;

  const setEnabled = (nextEnabled: boolean) => {
    if (disposed || enabled === nextEnabled) return;
    enabled = nextEnabled;
    if (!enabled) {
      removeContent?.();
      removeContent = null;
      return;
    }
    if (removeContent) return;
    if (startContent) {
      try {
        removeContent = startContent();
      } catch (error) {
        console.error("[we-were-online] Could not start installation mode:", error);
      }
      return;
    }
    if (loading) return;
    loading = import(
      /* @vite-ignore */ browser.runtime.getURL("installation.js")
    )
      .then(() => {
        startContent =
          (
            globalThis as typeof globalThis & {
              wwoInstallationContent?: () => () => void;
            }
          ).wwoInstallationContent ?? null;
        if (!startContent) {
          throw new Error("Installation components did not register");
        }
        loading = null;
        if (!disposed && enabled) {
          removeContent = startContent();
        }
      })
      .catch((error) => {
        loading = null;
        if (!disposed && enabled) {
          console.error(
            "[we-were-online] Could not load installation mode:",
            error,
          );
        }
      });
  };

  const onStorage = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !changes[INSTALLATION_MODE_KEY]) return;
    revision++;
    setEnabled(changes[INSTALLATION_MODE_KEY].newValue === true);
  };

  browser.storage.onChanged.addListener(onStorage);
  const initialRevision = revision;
  void browser.storage.local.get(INSTALLATION_MODE_KEY).then(
    (stored) => {
      if (initialRevision === revision) {
        setEnabled(stored[INSTALLATION_MODE_KEY] === true);
      }
    },
    (error) => {
      if (!disposed) {
        console.error(
          "[we-were-online] Could not read installation mode:",
          error,
        );
      }
    },
  );

  return () => {
    disposed = true;
    revision++;
    browser.storage.onChanged.removeListener(onStorage);
    removeContent?.();
    removeContent = null;
  };
}
