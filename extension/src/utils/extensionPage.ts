// ABOUTME: Identifies pages served from a browser extension origin.
// ABOUTME: Covers the URL schemes used by Chrome, Firefox, and Safari.

const EXTENSION_PROTOCOLS = new Set([
  "chrome-extension:",
  "moz-extension:",
  "safari-web-extension:",
]);

export function isExtensionPageUrl(url: string): boolean {
  try {
    return EXTENSION_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
