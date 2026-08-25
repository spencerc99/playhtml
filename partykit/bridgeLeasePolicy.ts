// ABOUTME: Merges and renews shared-reference leases for active bridge consumers.
// ABOUTME: Preserves source metadata while extending only requested relationships.
import type { SharedRefEntry } from "./const";

type SharedReferenceRequest = {
  sourceRoomId: string;
  elementIds: string[];
};

type MergeSharedReferenceLeasesOptions = {
  existing: readonly SharedRefEntry[];
  requested: readonly SharedReferenceRequest[];
  nowIso: string;
};

export function mergeSharedReferenceLeases({
  existing,
  requested,
  nowIso,
}: MergeSharedReferenceLeasesOptions): {
  entries: SharedRefEntry[];
  changed: boolean;
} {
  if (requested.length === 0) {
    return { entries: [...existing], changed: false };
  }

  const requestedBySource = new Map(
    requested.map((entry) => [entry.sourceRoomId, entry.elementIds] as const)
  );
  const entries = existing.map((entry) => {
    const requestedIds = requestedBySource.get(entry.sourceRoomId);
    if (requestedIds === undefined) return { ...entry };

    requestedBySource.delete(entry.sourceRoomId);
    return {
      ...entry,
      elementIds: Array.from(new Set([...entry.elementIds, ...requestedIds])),
      lastSeen: nowIso,
    };
  });

  for (const [sourceRoomId, elementIds] of requestedBySource) {
    entries.push({
      sourceRoomId,
      elementIds: Array.from(new Set(elementIds)),
      lastSeen: nowIso,
    });
  }

  return { entries, changed: true };
}
