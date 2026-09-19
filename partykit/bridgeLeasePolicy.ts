// ABOUTME: Merges and renews shared-reference leases for active bridge consumers.
// ABOUTME: Preserves source metadata while extending only requested relationships.
import { DEFAULT_SUBSCRIBER_LEASE_MS, type SharedRefEntry } from "./const";

const SHARED_REFERENCE_RENEWAL_MS = DEFAULT_SUBSCRIBER_LEASE_MS / 2;

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
  let changed = false;
  const now = Date.parse(nowIso);
  const entries = existing.map((entry) => {
    const requestedIds = requestedBySource.get(entry.sourceRoomId);
    if (requestedIds === undefined) return { ...entry };

    requestedBySource.delete(entry.sourceRoomId);
    const elementIds = Array.from(
      new Set([...entry.elementIds, ...requestedIds])
    );
    const lastSeen = Date.parse(entry.lastSeen ?? "");
    const membershipChanged = elementIds.length !== entry.elementIds.length;
    const leaseNeedsRenewal =
      !Number.isFinite(lastSeen) ||
      !Number.isFinite(now) ||
      now - lastSeen >= SHARED_REFERENCE_RENEWAL_MS;

    if (!membershipChanged && !leaseNeedsRenewal) {
      return { ...entry };
    }

    changed = true;
    return {
      ...entry,
      elementIds,
      lastSeen: nowIso,
    };
  });

  for (const [sourceRoomId, elementIds] of requestedBySource) {
    changed = true;
    entries.push({
      sourceRoomId,
      elementIds: Array.from(new Set(elementIds)),
      lastSeen: nowIso,
    });
  }

  return { entries, changed };
}
