// ABOUTME: Notices when the we were online extension hands this page its identity.
// ABOUTME: Joining the walk needs the extension, since it is what reports the pages you visit.

// The extension's content script dispatches this on the shared DOM (and again
// once playhtml says it's ready). Listening from module load catches the first
// dispatch, which can land before React mounts.
const IDENTITY_EVENT = "playhtml:configure-identity";
// Set on <html> by every version of the extension's content script, whether
// or not it hands over an identity.
const INSTALL_ATTRIBUTE = "data-we-were-online-extension";

let detected = false;
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
}

export function hasExtension(): boolean {
  return detected;
}

export function onExtensionDetected(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The extension is installed but hasn't handed over an identity, which an
 * older version (or one blocked by the browser) can't do. Joining still needs
 * the identity, so these walkers are asked to update rather than install.
 */
export function hasExtensionWithoutIdentity(): boolean {
  return (
    !detected &&
    typeof document !== "undefined" &&
    document.documentElement.getAttribute(INSTALL_ATTRIBUTE) === "installed"
  );
}
