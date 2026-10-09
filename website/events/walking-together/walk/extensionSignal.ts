// ABOUTME: Notices when the we were online extension hands this page its identity.
// ABOUTME: Joining the walk needs the extension, since it is what reports the pages you visit.

// The extension's content script dispatches this on the shared DOM (and again
// once playhtml says it's ready). Listening from module load catches the first
// dispatch, which can land before React mounts.
const IDENTITY_EVENT = "playhtml:configure-identity";
// Set on <html> by every version of the extension's content script, whether
// or not it hands over an identity.
const INSTALL_ATTRIBUTE = "data-we-were-online-extension";

// The extension checks in a moment after the page loads: it waits for the
// page's playhtml and asks its background for the identity. Until then the
// join button shows a loading state rather than flashing a wrong prompt.
const CHECK_MS = 5000;

let detected = false;
let checking = true;
const listeners = new Set<() => void>();

if (typeof document !== "undefined") {
  document.addEventListener(IDENTITY_EVENT, () => {
    if (detected) return;
    detected = true;
    listeners.forEach((fn) => fn());
  });
  new MutationObserver(() => listeners.forEach((fn) => fn())).observe(
    document.documentElement,
    { attributes: true, attributeFilter: [INSTALL_ATTRIBUTE] },
  );
  setTimeout(() => {
    checking = false;
    listeners.forEach((fn) => fn());
  }, CHECK_MS);
}

export function hasExtension(): boolean {
  return detected;
}

export function onExtensionDetected(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type ExtensionStatus = "checking" | "ready" | "update" | "missing";

/**
 * "ready" once the extension hands over an identity. Otherwise, after the
 * check-in window: "update" when it is installed but sent none (an older
 * version, or one the browser blocked), and "missing" when it isn't installed.
 */
export function extensionStatus(): ExtensionStatus {
  if (detected) return "ready";
  if (checking) return "checking";
  return document.documentElement.getAttribute(INSTALL_ATTRIBUTE) === "installed"
    ? "update"
    : "missing";
}
