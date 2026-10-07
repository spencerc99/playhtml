// ABOUTME: Detects whether the browser extension is present on public commute pages.
// ABOUTME: Delays missing-state promotions so the content-script marker can arrive.

import { useEffect, useState } from "react";
import {
  EXTENSION_INSTALL_ATTRIBUTE,
  isExtensionInstalled,
} from "../../utils/extensionInstallMarker";

const EXTENSION_DETECTION_MS = 800;

export type InstallState = "checking" | "installed" | "missing";

export function isPublicWebPage(): boolean {
  return (
    window.location.protocol === "http:" ||
    window.location.protocol === "https:"
  );
}

export function useExtensionInstallState(): InstallState {
  const [state, setState] = useState<InstallState>(() => {
    if (!isPublicWebPage()) return "installed";
    return isExtensionInstalled(document.documentElement)
      ? "installed"
      : "checking";
  });

  useEffect(() => {
    if (!isPublicWebPage()) return;

    const root = document.documentElement;
    if (isExtensionInstalled(root)) {
      setState("installed");
      return;
    }

    const observer = new MutationObserver(() => {
      if (isExtensionInstalled(root)) {
        setState("installed");
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: [EXTENSION_INSTALL_ATTRIBUTE],
    });

    const timer = window.setTimeout(() => {
      setState((current) => (current === "checking" ? "missing" : current));
    }, EXTENSION_DETECTION_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}
