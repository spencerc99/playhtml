// ABOUTME: Shows browser-store links on the public commute when the extension is absent.
// ABOUTME: Waits for the content-script marker so installed riders do not see the prompt.

import { useEffect, useState } from "react";
import { DOWNLOAD_LINKS } from "@movement/downloadLinks";
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
    <aside
      className="commute-install-cta"
      aria-label="Download the we were online extension"
    >
      <span className="commute-install-cta__ticket" aria-hidden="true">
        ADD YOUR STOP
      </span>
      <span className="commute-install-cta__copy">
        <strong>make your browsing part of the line</strong>
        <span>get the extension to leave stops for future riders</span>
      </span>
      <span className="commute-install-cta__links">
        <span>download:</span>
        {DOWNLOAD_LINKS.map(({ browser, url }) => (
          <a key={browser} href={url} target="_blank" rel="noreferrer">
            {browser}
          </a>
        ))}
      </span>
    </aside>
  );
}
