// ABOUTME: Defines the shared cinder-block yard state and transform comparison helpers.
// ABOUTME: Keeps persistent block records flat, keyed, and compact for PlayHTML syncing.

export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 720;
export const BLOCK_WIDTH = 200;
export const BLOCK_HEIGHT = 96;

const POSITION_SYNC_THRESHOLD = 0.35;
const ANGLE_SYNC_THRESHOLD = 0.004;

const INITIAL_BLOCKS = [
  ["block-1", 180, 642, "photo"],
  ["block-2", 390, 642, "css"],
  ["block-3", 600, 642, "photo"],
  ["block-4", 810, 642, "css"],
  ["block-5", 1020, 642, "photo"],
  ["block-6", 285, 546, "css"],
  ["block-7", 495, 546, "photo"],
  ["block-8", 705, 546, "css"],
  ["block-9", 915, 546, "photo"],
];

export function createDefaultYard() {
  return {
    blocks: Object.fromEntries(
      INITIAL_BLOCKS.map(([id, x, y, style]) => [
        id,
        { x, y, angle: 0, style },
      ]),
    ),
  };
}

export function createBlock(id, style, blockCount) {
  const columns = 5;
  const column = blockCount % columns;

  return {
    id,
    transform: {
      x: 180 + column * 210,
      y: 100 + Math.floor(blockCount / columns) % 2 * 28,
      angle: 0,
      style,
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
