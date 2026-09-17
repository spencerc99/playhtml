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

export function isSafariExtensionPageUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "safari-web-extension:";
  } catch {
    return false;
  }
}

export function isFirefoxExtensionPageUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "moz-extension:";
  } catch {
    return false;
  }
}
