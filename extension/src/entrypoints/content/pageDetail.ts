// ABOUTME: Makes CustomEvent details from the content script readable by page scripts.
// ABOUTME: Firefox wraps content-script objects so the page gets "Permission denied" without this.

declare const cloneInto:
  | (<T>(obj: T, target: object, options?: { cloneFunctions?: boolean }) => T)
  | undefined;

/**
 * A `detail` the page can read. In Firefox, an object made in the content
 * script is opaque to page code ("Permission denied to access property"), so
 * it has to be cloned into the page's compartment. Chrome and Safari share
 * plain data across worlds already, so the object passes through unchanged.
 */
export function detailForPage<T>(detail: T): T {
  if (typeof cloneInto === "function" && typeof window !== "undefined") {
    return cloneInto(detail, window);
  }
  return detail;
}
