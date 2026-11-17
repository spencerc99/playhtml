// ABOUTME: Converts PlayHTML Y.Doc state to and from persisted database snapshots.
// ABOUTME: Provides reset metadata and snapshot relationship helpers for PartyServer.

/**
 * Shared utilities for working with Y.Doc and PlayHTML data structures.
 * These functions ensure consistent conversion between Y.Doc, SyncedStore proxies,
 * and plain JSON objects throughout the admin console and server code.
 */

import * as Y from "yjs";
import { syncedStore } from "@syncedstore/core";
import { clonePlain } from "@playhtml/common";
import { Buffer } from "node:buffer";

const META_MAP_NAME = "__playhtml_meta";

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
    (tag) => Object.keys(playData[tag] || {}).length > 0,
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
  playData: Record<string, any>,
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
  snapshotBase64: string,
): void {
  const buffer = new Uint8Array(Buffer.from(snapshotBase64, "base64"));

  // Use a specific origin to help distinguish this "system" update if needed
  const origin = "hard-reset";

  doc.transact(() => {
    // NUCLEAR OPTION: Deep clean the Y.Doc internals to remove history/tombstones.
    // This is required because standard delete() operations leave tombstones.
    // Accessing private API (doc.store) is necessary for this.

    try {
      // @ts-ignore - Accessing internal store
      const store = doc.store;
      if (store) {
        // Clear clients (history vector)
        // @ts-ignore
        if (store.clients) store.clients.clear();
        // Clear pending structs
        // @ts-ignore
        store.pendingStructs = null;
        // @ts-ignore
        store.pendingDs = null;
      }

      // Clear shared types map
      doc.share.clear();
    } catch (e) {
      console.error("Failed to deep clean doc store:", e);
      // Fallback to standard clear if internals change
      for (const key of Array.from(doc.share.keys())) {
        doc.share.delete(key);
      }
    }

    // Apply the snapshot. Since the store is empty, this is effectively a fresh load.
    Y.applyUpdate(doc, buffer);
  }, origin);
}

/**
 * Set the reset epoch metadata on a Y.Doc.
 *
 * We mirror the authoritative epoch (stored in PartyKit room storage) inside
 * the Y.Doc itself so that autosave can tell whether the in-memory doc is
 * allowed to write back to the database. Without this, a hibernated or stale
 * PartyKit instance could wake up with pre-reset data and overwrite the clean
 * snapshot. By baking the epoch into the doc, every autosave can compare the
 * doc's view of history against the server's view and skip writes when they
 * diverge.
 */
export function setDocResetEpoch(doc: Y.Doc, epoch: number): void {
  const meta = doc.getMap(META_MAP_NAME);
  meta.set("resetEpoch", epoch);
}

/**
 * Get the reset epoch metadata from a Y.Doc, if present.
 */
export function getDocResetEpoch(doc: Y.Doc): number | null {
  const meta = doc.getMap(META_MAP_NAME);
  const value = meta.get("resetEpoch");
  return typeof value === "number" ? value : null;
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

type ClockRange = { clock: number; len: number };

function sortedMergedRanges(ranges: ClockRange[]): ClockRange[] {
  const sorted = ranges
    .map(({ clock, len }) => ({ clock, len }))
    .sort((a, b) => a.clock - b.clock);
  const merged: ClockRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.clock + last.len >= range.clock) {
      last.len =
        Math.max(last.clock + last.len, range.clock + range.len) - last.clock;
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function rangeIsCovered(range: ClockRange, covering: ClockRange[]): boolean {
  let low = 0;
  let high = covering.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = covering[mid];
    if (candidate.clock + candidate.len <= range.clock) {
      low = mid + 1;
    } else if (candidate.clock > range.clock) {
      high = mid - 1;
    } else {
      return range.clock + range.len <= candidate.clock + candidate.len;
    }
  }
  return false;
}

/**
 * Returns whether `documentBase64` contains every Yjs update from
 * `snapshotBase64`: every struct in the snapshot is within the document's
 * state vector, and every range the snapshot deletes is also deleted in the
 * document. Works on encoded updates without building Y.Docs.
 *
 * Pending structs (ones after a clock gap) are never treated as contained, so
 * the answer can be a conservative false for updates that carry them.
 */
export function documentContainsSnapshot(
  documentBase64: string,
  snapshotBase64: string,
): boolean {
  const documentUpdate = new Uint8Array(Buffer.from(documentBase64, "base64"));
  const snapshotUpdate = new Uint8Array(Buffer.from(snapshotBase64, "base64"));
  const documentStateVector = Y.encodeStateVectorFromUpdate(documentUpdate);

  // diffUpdate keeps only snapshot structs past the document's state vector
  // and always carries the snapshot's full delete set.
  const snapshotRemainder = Y.decodeUpdate(
    Y.diffUpdate(snapshotUpdate, documentStateVector),
  );
  if (snapshotRemainder.structs.some((struct) => !(struct instanceof Y.Skip))) {
    return false;
  }
  if (snapshotRemainder.ds.clients.size === 0) {
    return true;
  }

  // Diffing the document against its own state vector drops its integrated
  // structs and leaves its delete set.
  const documentDeletes = Y.decodeUpdate(
    Y.diffUpdate(documentUpdate, documentStateVector),
  ).ds;
  for (const [client, ranges] of snapshotRemainder.ds.clients) {
    const covering = sortedMergedRanges(
      documentDeletes.clients.get(client) ?? [],
    );
    for (const range of sortedMergedRanges(ranges)) {
      if (!rangeIsCovered(range, covering)) {
        return false;
      }
    }
  }
  return true;
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
