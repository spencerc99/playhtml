// ABOUTME: Exposes extension installation to public pages through a DOM marker.
// ABOUTME: Lets website features hide installation prompts when the content script is present.

export const EXTENSION_INSTALL_ATTRIBUTE = "data-we-were-online-extension";

export function markExtensionInstalled(root: Element): void {
  root.setAttribute(EXTENSION_INSTALL_ATTRIBUTE, "installed");
}

export function isExtensionInstalled(root: Element): boolean {
  return root.getAttribute(EXTENSION_INSTALL_ATTRIBUTE) === "installed";
}
