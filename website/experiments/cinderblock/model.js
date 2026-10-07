// ABOUTME: Defines the cinder-block experiment state and transform comparison helpers.
// ABOUTME: Keeps persistent block records flat, keyed, and compact for PlayHTML syncing.

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 720;
export const BLOCK_WIDTH = 200;
export const BLOCK_HEIGHT = 96;

/** Shared site-diary saves must wait this long between captures. */
export const SNAPSHOT_COOLDOWN_MS = 15 * 60 * 1000;
/** Keep the diary from growing without bound in the synced room. */
export const MAX_SNAPSHOTS = 48;

const POSITION_SYNC_THRESHOLD = 0.35;
const ANGLE_SYNC_THRESHOLD = 0.004;

const INITIAL_BLOCKS = [
  ["block-1", 180, 642],
  ["block-2", 390, 642],
  ["block-3", 600, 642],
  ["block-4", 810, 642],
  ["block-5", 1020, 642],
  ["block-6", 285, 546],
  ["block-7", 495, 546],
  ["block-8", 705, 546],
  ["block-9", 915, 546],
];

export function createDefaultYard() {
  return {
    blocks: Object.fromEntries(
      INITIAL_BLOCKS.map(([id, x, y]) => [
        id,
        { x, y, angle: 0, style: "photo" },
      ]),
    ),
    // New field: rooms that already have blocks hydrate without this key.
    snapshots: {},
  };
}

export function compactBlockTransform(block) {
  return {
    x: Math.round(Number(block.x) * 10) / 10,
    y: Math.round(Number(block.y) * 10) / 10,
    angle: Math.round(Number(block.angle) * 10_000) / 10_000,
  };
}

/**
 * Freeze the live yard into a compact keyed transform map for the site diary.
 * Avoids storing image bytes in the synced room.
 */
export function compactBlocksSnapshot(blocks) {
  return Object.fromEntries(
    Object.entries(blocks || {}).map(([id, block]) => [
      id,
      compactBlockTransform(block),
    ]),
  );
}

export function isBlockSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      typeof snapshot === "object" &&
      snapshot.blocks &&
      typeof snapshot.blocks === "object" &&
      !Array.isArray(snapshot.blocks),
  );
}

export function getSnapshotBlockCount(snapshot) {
  if (!isBlockSnapshot(snapshot)) return 0;
  return Object.keys(snapshot.blocks).length;
}

export function getSnapshots(data) {
  if (!data || typeof data !== "object" || !data.snapshots) return {};
  if (typeof data.snapshots !== "object" || Array.isArray(data.snapshots)) {
    return {};
  }
  return data.snapshots;
}

export function listSnapshotsNewestFirst(data) {
  return Object.values(getSnapshots(data))
    .filter(isBlockSnapshot)
    .sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));
}

export function getLatestSnapshotTime(data) {
  let latest = 0;
  for (const snapshot of listSnapshotsNewestFirst(data)) {
    const createdAt = Number(snapshot?.createdAt) || 0;
    if (createdAt > latest) latest = createdAt;
  }
  return latest;
}

export function getSnapshotCooldownRemainingMs(data, now = Date.now()) {
  const latest = getLatestSnapshotTime(data);
  if (!latest) return 0;
  return Math.max(0, SNAPSHOT_COOLDOWN_MS - (now - latest));
}

export function canSaveSnapshot(data, now = Date.now()) {
  return getSnapshotCooldownRemainingMs(data, now) === 0;
}

export function formatCooldown(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function createSnapshotRecord({
  id,
  blocks,
  createdAt = Date.now(),
}) {
  return {
    id,
    createdAt,
    blocks: compactBlocksSnapshot(blocks),
  };
}

/**
 * Apply a new snapshot into a draft snapshots map, pruning oldest when over cap.
 * Also drops legacy image-byte snapshots so they don't keep bloating the room.
 * Mutates `snapshots` in place for SyncedStore draft writes.
 */
export function applySnapshotToDraft(snapshots, record) {
  for (const [id, existing] of Object.entries(snapshots)) {
    if (!isBlockSnapshot(existing)) delete snapshots[id];
  }

  snapshots[record.id] = record;

  const idsByAge = Object.values(snapshots)
    .filter(isBlockSnapshot)
    .sort((a, b) => (a?.createdAt ?? 0) - (b?.createdAt ?? 0))
    .map((snapshot) => snapshot.id);

  while (idsByAge.length > MAX_SNAPSHOTS) {
    const oldestId = idsByAge.shift();
    if (oldestId) delete snapshots[oldestId];
  }
}

export function createBlock(id, blockCount) {
  const columns = 5;
  const column = blockCount % columns;

  return {
    id,
    transform: {
      x: 180 + column * 210,
      y: 100 + (Math.floor(blockCount / columns) % 2) * 28,
      angle: 0,
      style: "photo",
    },
  };
}

export function roundTransform(body) {
  return {
    x: Math.round(body.position.x * 10) / 10,
    y: Math.round(body.position.y * 10) / 10,
    angle: Math.round(body.angle * 10_000) / 10_000,
  };
}

export function getChangedTransforms(current, previous, controlledIds = null) {
  return Object.fromEntries(
    Object.entries(current).filter(([id, transform]) => {
      if (controlledIds && !controlledIds.has(id)) return false;
      const lastTransform = previous[id];
      if (!lastTransform) return true;

      return (
        Math.abs(transform.x - lastTransform.x) >= POSITION_SYNC_THRESHOLD ||
        Math.abs(transform.y - lastTransform.y) >= POSITION_SYNC_THRESHOLD ||
        Math.abs(transform.angle - lastTransform.angle) >= ANGLE_SYNC_THRESHOLD
      );
    }),
  );
}

export function interpolateTransform(current, target, amount) {
  const boundedAmount = Math.max(0, Math.min(1, amount));
  const angleDelta = Math.atan2(
    Math.sin(target.angle - current.angle),
    Math.cos(target.angle - current.angle),
  );

  return {
    x: current.x + (target.x - current.x) * boundedAmount,
    y: current.y + (target.y - current.y) * boundedAmount,
    angle: current.angle + angleDelta * boundedAmount,
  };
}
