/**
 * Shared utilities for working with Y.Doc and PlayHTML data structures.
 * These functions ensure consistent conversion between Y.Doc, SyncedStore proxies,
 * and plain JSON objects throughout the admin console and server code.
 */

import * as Y from "yjs";
import { syncedStore } from "@syncedstore/core";
import { clonePlain } from "@playhtml/common";
import { Buffer } from "node:buffer";

/**
 * Extract plain JSON data from a Y.Doc's play structure.
 * Uses SyncedStore to access the data exactly as PlayHTML clients do.
 *
 * @param doc The Y.Doc to extract data from
 * @returns Plain object representing store.play data, or null if doc has no play data
 */
export function docToJson(doc: Y.Doc): Record<string, any> | null {
  const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
  const playData = clonePlain(store.play);
  const hasAnyData = Object.keys(playData).some(
    (tag) => Object.keys(playData[tag] || {}).length > 0
  );
  return hasAnyData ? playData : null;
}

/**
 * Replace all data in a Y.Doc's play structure with new plain JSON data.
 * This clears existing state and applies the new data atomically.
 *
 * @param doc The Y.Doc to modify (typically the live doc)
 * @param playData Plain object representing the new play data structure
 */
export function replaceDocState(
  doc: Y.Doc,
  playData: Record<string, any>
): void {
  const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);

  // Clear existing state and apply new data in a transaction
  doc.transact(() => {
    // Clear all existing keys
    for (const key of Object.keys(store.play)) {
      delete store.play[key];
    }

    // Apply new data
    for (const [key, value] of Object.entries(playData)) {
      store.play[key] = value;
    }
  });
}

/**
 * Clear all data from a Y.Doc's play structure.
 * Useful when replacing with a DB snapshot that should completely overwrite state.
 *
 * @param doc The Y.Doc to clear
 */
export function clearDocState(doc: Y.Doc): void {
  const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
  doc.transact(() => {
    for (const key of Object.keys(store.play)) {
      delete store.play[key];
    }
  });
}

/**
 * Replace a Y.Doc's state by clearing it and applying a DB snapshot.
 * This is used when the database has been updated externally and we need
 * to sync the live doc to match.
 *
 * @param doc The live Y.Doc to update
 * @param snapshotBase64 Base64-encoded Y.Doc update from the database
 */
export function replaceDocFromSnapshot(
  doc: Y.Doc,
  snapshotBase64: string
): void {
  const buffer = new Uint8Array(Buffer.from(snapshotBase64, "base64"));
  doc.transact(() => {
    // Clear all existing shared types before applying snapshot
    // This ensures we don't merge stale data
    for (const key of Array.from(doc.share.keys())) {
      doc.share.delete(key);
    }
    Y.applyUpdate(doc, buffer);
  });
}

/**
 * Encode a Y.Doc to base64 for database storage.
 *
 * @param doc The Y.Doc to encode
 * @returns Base64-encoded string ready for database storage
 */
export function encodeDocToBase64(doc: Y.Doc): string {
  const content = Y.encodeStateAsUpdate(doc);
  return Buffer.from(content).toString("base64");
}

/**
 * Create a new Y.Doc from plain JSON play data.
 * Useful for creating fresh documents (e.g., for admin edits).
 * Note: For modifying the live doc, use replaceDocState instead.
 *
 * @param playData Plain object representing play data structure
 * @returns A new Y.Doc with the data applied
 */
export function jsonToDoc(playData: Record<string, any>): Y.Doc {
  const doc = new Y.Doc();
  const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
  doc.transact(() => {
    for (const [key, value] of Object.entries(playData)) {
      store.play[key] = value;
    }
  });
  return doc;
}

