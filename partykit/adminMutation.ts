// ABOUTME: Builds authoritative room snapshots for admin data mutations.
// ABOUTME: Keeps manual edits and moderation writes on the same reset-safe path.
import {
  encodeDocToBase64,
  jsonToDoc,
  setDocResetEpoch,
} from "./docUtils";

export interface AdminSnapshot {
  base64: string;
  documentSize: number;
  resetEpoch: number;
}

export interface RoomResetEpochOptions {
  snapshotEpoch: number | null;
  storedEpoch: number | null;
  bumpEpoch: boolean;
  now: number;
}

export function resolveRoomResetEpoch({
  snapshotEpoch,
  storedEpoch,
  bumpEpoch,
  now,
}: RoomResetEpochOptions): number {
  if (bumpEpoch) {
    return Math.max(now, (storedEpoch ?? 0) + 1);
  }

  if (snapshotEpoch === null) {
    return storedEpoch ?? now;
  }

  return Math.max(snapshotEpoch, storedEpoch ?? snapshotEpoch);
}

export function createAdminSnapshotFromPlayData(
  playData: Record<string, any>,
  resetEpoch: number
): AdminSnapshot {
  const doc = jsonToDoc(playData);
  setDocResetEpoch(doc, resetEpoch);
  const base64 = encodeDocToBase64(doc);

  return {
    base64,
    documentSize: base64.length,
    resetEpoch,
  };
}
