// ABOUTME: Notices when the we were online extension hands this page its identity.
// ABOUTME: Joining the walk needs the extension, since it is what reports the pages you visit.

// The extension's content script dispatches this on the shared DOM (and again
// once playhtml says it's ready). Listening from module load catches the first
// dispatch, which can land before React mounts.
const IDENTITY_EVENT = "playhtml:configure-identity";

let detected = false;
const listeners = new Set<() => void>();

if (typeof document !== "undefined") {
  document.addEventListener(IDENTITY_EVENT, () => {
    if (detected) return;
    detected = true;
    listeners.forEach((fn) => fn());
  });
}

export function hasExtension(): boolean {
  return detected;
}

export function onExtensionDetected(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
