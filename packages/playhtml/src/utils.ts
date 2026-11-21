// ABOUTME: Small helpers for element setup: shared-store snapshots and hash ids.
// ABOUTME: Kept dependency-light so index.ts and page-data.ts can share them.
import { clonePlain } from "@playhtml/common";
import { getYjsValue } from "@syncedstore/core";

/**
 * Plain snapshot of a value read from the shared store. SyncedStore proxies
 * cannot be structured-cloned (the attempt always throws), so they go straight
 * to the JSON round-trip clonePlain falls back to; everything else goes
 * through clonePlain unchanged.
 */
export function cloneStoreValue<T>(value: T): T {
  if (getYjsValue(value) !== undefined) {
    return JSON.parse(JSON.stringify(value));
  }
  return clonePlain(value);
}

const warnedHashedElements = new WeakSet<Element>();

/** Warns, once per element, that its data is keyed by a hash of its markup and
 * is orphaned by any change to that HTML. Callers gate it on development mode. */
export function warnHashedElementId(tag: string, element: Element): void {
  if (warnedHashedElements.has(element)) return;
  warnedHashedElements.add(element);
  console.warn(
    `[playhtml] A ${tag} element has no id, so its data is saved under a hash of its HTML. Any change to its markup will lose that data. Please add an id (or a selector-id for many-of-a-kind elements).`,
    element,
  );
}

export function hashElement(tag: string, element: Element): Promise<string> {
  return hashHtml(tag, element.outerHTML);
}

export async function hashHtml(tag: string, html: string): Promise<string> {
  // The input string (stray "}" included) is frozen: changing it would re-key
  // the saved data of every element that uses a hashed id.
  const msgUint8 = new TextEncoder().encode(`${tag}-${html}}`);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msgUint8);

  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // convert bytes to hex string
  return hashHex;
}
