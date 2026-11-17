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

export async function hashElement(
  tag: string,
  element: Element
): Promise<string> {
  const msgUint8 = new TextEncoder().encode(`${tag}-${element.outerHTML}}`);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msgUint8);

  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""); // convert bytes to hex string
  return hashHex;
}
