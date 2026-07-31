// ABOUTME: Links the public commute to the extension homepage when installation is absent.
// ABOUTME: Waits for the content-script marker so installed riders do not see the prompt.

import { useEffect, useState } from "react";
import {
  EXTENSION_INSTALL_ATTRIBUTE,
  isExtensionInstalled,
} from "../../utils/extensionInstallMarker";

const EXTENSION_DETECTION_MS = 800;

type InstallState = "checking" | "installed" | "missing";

function isPublicWebPage(): boolean {
  return (
    window.location.protocol === "http:" ||
    window.location.protocol === "https:"
  );
}

function useExtensionInstallState(): InstallState {
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

export function CommuteInstallPrompt() {
  const installState = useExtensionInstallState();
  if (installState !== "missing") return null;

  return (
    <a
      className="commute-install-cta"
      href="https://wewere.online/"
      target="_blank"
      rel="noreferrer"
      aria-label="Visit we were online to download the extension"
    >
      <span className="commute-install-cta__copy">
        <strong>add your stops</strong>
        <span>get the extension →</span>
      </span>
      <span className="commute-install-cta__ticket" aria-hidden="true">
        WWO
      </span>
    </a>
  );
}
