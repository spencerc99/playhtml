// ABOUTME: Defines the cinder-block experiment state and transform comparison helpers.
// ABOUTME: Keeps persistent block records flat, keyed, and compact for PlayHTML syncing.

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 720;
export const BLOCK_WIDTH = 200;
export const BLOCK_HEIGHT = 96;

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
  };
}

export function createBlock(id, blockCount) {
  const columns = 5;
  const column = blockCount % columns;

  return {
    id,
    transform: {
      x: 180 + column * 210,
      y: 100 + Math.floor(blockCount / columns) % 2 * 28,
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

export function getChangedTransforms(current, previous) {
  return Object.fromEntries(
    Object.entries(current).filter(([id, transform]) => {
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
