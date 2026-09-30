// ABOUTME: Links the public commute to the extension homepage when installation is absent.
// ABOUTME: Waits for the content-script marker so installed riders do not see the prompt.

import { useExtensionInstallState } from "./commuteInstallState";

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
      <span className="commute-install-cta__icon" aria-hidden="true" />
      <span className="commute-install-cta__copy">
        <span className="commute-install-cta__label">
          internet transit pass
        </span>
        <strong>join the ride</strong>
        <span>get the extension →</span>
      </span>
    </a>
  );
}
