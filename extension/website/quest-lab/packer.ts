// ABOUTME: Packs cut-out pieces snugly into a region by their real outlines, the way Wiki Spy tiles objects.
// ABOUTME: Works on a coarse grid: each piece is rasterized at a few angles and slid into the tightest free spot.

/** A region to fill: set cells are inside. One cell is `scale` frame pixels. */
export interface PackRegion {
  mask: Uint8ClampedArray;
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface PackPiece {
  id: string;
  /** Unrotated box in frame pixels. */
  width: number;
  height: number;
  /** The piece's own silhouette, or null for a solid rectangle. */
  outline: { mask: Uint8ClampedArray; width: number; height: number } | null;
  /** Angles in degrees to try, best fit wins. */
  angles: number[];
  /** Big pieces look for room deep in free space; small ones fill crevices. */
  deep: boolean;
  /** A target cell to place near, such as a hero's spot in a composition. */
  near?: { x: number; y: number; radius: number };
}

export interface Packed {
  /** Box center in frame pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** How much the piece shrank to fit, 1 meaning not at all. */
  shrink: number;
  /** Share of the piece's cells that overlap others or leave the region. */
  clash: number;
}

export interface PackOptions {
  random: () => number;
  /** Spots tried per angle and size. */
  tries: number;
  /** Empty cells kept around each piece; 0 lets outlines touch. */
  gap: number;
}

export interface PackResult {
  placed: Map<string, Packed>;
  /** Pieces that found no room even after shrinking. */
  skipped: string[];
  /** Share of the region covered by piece cells. */
  coverage: number;
}

interface Raster {
  /** Cell offsets from the piece center that the piece covers. */
  cells: number[][];
  /** Covered cells with an uncovered neighbor, for measuring snugness. */
  edge: number[][];
  /** Half the shorter side in cells, for finding room deep enough. */
  inradius: number;
}

/** The cells a piece covers at a size and angle, sampling its own silhouette. */
function rasterize(piece: PackPiece, cellsW: number, cellsH: number, degrees: number): Raster {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const reach = Math.ceil(Math.hypot(cellsW, cellsH) / 2) + 1;
  const covered = new Set<string>();
  const cells: number[][] = [];
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      // Back into the piece's own unrotated frame.
      const x = dx * cos + dy * sin;
      const y = -dx * sin + dy * cos;
      if (Math.abs(x) > cellsW / 2 || Math.abs(y) > cellsH / 2) continue;
      if (piece.outline) {
        const { mask, width, height } = piece.outline;
        const u = Math.min(width - 1, Math.floor((x / cellsW + 0.5) * width));
        const v = Math.min(height - 1, Math.floor((y / cellsH + 0.5) * height));
        if (mask[v * width + u] === 0) continue;
      }
      cells.push([dx, dy]);
      covered.add(`${dx},${dy}`);
    }
  }
  // A piece smaller than a cell still takes one.
  if (cells.length === 0) {
    cells.push([0, 0]);
    covered.add("0,0");
  }
  const edge = cells.filter(([dx, dy]) =>
    !covered.has(`${dx - 1},${dy}`) || !covered.has(`${dx + 1},${dy}`) ||
    !covered.has(`${dx},${dy - 1}`) || !covered.has(`${dx},${dy + 1}`),
  );
  return { cells, edge, inradius: Math.min(cellsW, cellsH) / 2 };
}

/** Distance from each free cell to the nearest taken or outside cell (chamfer approximation). */
function freeDistance(region: PackRegion, taken: Uint8Array): Float32Array {
  const { width, height } = region;
  const far = width + height;
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i += 1) distance[i] = region.mask[i] > 0 && !taken[i] ? far : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : distance[y * width + x]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      distance[i] = Math.min(distance[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (distance[i] === 0) continue;
      distance[i] = Math.min(distance[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  }
  return distance;
}

/** Shrink steps tried when a piece does not fit at its size. */
const SHRINKS = [1, 0.82, 0.66, 0.5];
/** Clash allowed at full effort; a piece over this at every size is skipped. */
const FIT_CLASH = 0.04;
const LAST_RESORT_CLASH = 0.18;

/**
 * Places pieces in order, each at the angle, size, and spot where it clashes
 * least with the region's edge and the pieces already down, preferring spots
 * that hug its neighbors. Pieces are expected biggest first.
 */
export function pack(region: PackRegion, pieces: PackPiece[], options: PackOptions): PackResult {
  const { width: gw, height: gh } = region;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && region.mask[y * gw + x] > 0;
  const taken = new Uint8Array(gw * gh);
  const filled = new Uint8Array(gw * gh);
  let regionCells = 0;
  for (const value of region.mask) if (value > 0) regionCells += 1;
  if (regionCells === 0) throw new Error("The region to pack is empty");

  const placed = new Map<string, Packed>();
  const skipped: string[] = [];
  let distance = freeDistance(region, taken);
  let sinceDistance = 0;

  for (const piece of pieces) {
    // Free space shrinks as pieces land; the distance map is refreshed now and then rather than every time.
    if (sinceDistance >= 6) {
      distance = freeDistance(region, taken);
      sinceDistance = 0;
    }
    let best: { score: number; clash: number; cx: number; cy: number; raster: Raster; angle: number; shrink: number } | null = null;

    for (const shrink of SHRINKS) {
      const cellsW = (piece.width * shrink) / region.scale;
      const cellsH = (piece.height * shrink) / region.scale;
      // Only spots with room for the piece's narrow side are worth trying; a
      // random free cell in a crowded region almost never fits.
      const deepEnough = Math.max(1, Math.min(cellsW, cellsH) * (piece.deep ? 0.45 : 0.35));
      let pool: number[] = [];
      // A piece with a target looks around it first, widening until it finds room.
      if (piece.near) {
        for (let radius = piece.near.radius; pool.length === 0 && radius < gw + gh; radius *= 2) {
          for (let i = 0; i < distance.length; i += 1) {
            if (distance[i] < deepEnough) continue;
            if (Math.hypot((i % gw) - piece.near.x, Math.floor(i / gw) - piece.near.y) <= radius) pool.push(i);
          }
        }
      }
      if (pool.length === 0) for (let i = 0; i < distance.length; i += 1) if (distance[i] >= deepEnough) pool.push(i);
      if (pool.length === 0) for (let i = 0; i < distance.length; i += 1) if (distance[i] > 0) pool.push(i);
      if (pool.length === 0) break;

      for (const angle of piece.angles) {
        const raster = rasterize(piece, cellsW, cellsH, angle);
        for (let attempt = 0; attempt < options.tries; attempt += 1) {
          const spot = pool[Math.floor(options.random() * pool.length)];
          const cx = spot % gw;
          const cy = Math.floor(spot / gw);
          let clash = 0;
          for (const [dx, dy] of raster.cells) {
            const x = cx + dx;
            const y = cy + dy;
            if (!inside(x, y) || taken[y * gw + x]) clash += 1;
          }
          let contact = 0;
          for (const [dx, dy] of raster.edge) {
            for (const [nx, ny] of [[dx - 1, dy], [dx + 1, dy], [dx, dy - 1], [dx, dy + 1]]) {
              const x = cx + nx;
              const y = cy + ny;
              if (!inside(x, y) || taken[y * gw + x]) {
                contact += 1;
                break;
              }
            }
          }
          const share = clash / raster.cells.length;
          // Clashes cost far more than contact earns: hug neighbors, never sit on them.
          const score = -share * 20 + (contact / Math.max(1, raster.edge.length)) * 1 + shrink * 0.5;
          if (!best || score > best.score) best = { score, clash: share, cx, cy, raster, angle, shrink };
        }
      }
      if (best && best.clash <= FIT_CLASH) break;
    }

    if (!best || best.clash > LAST_RESORT_CLASH) {
      skipped.push(piece.id);
      continue;
    }
    for (const [dx, dy] of best.raster.cells) {
      const x = best.cx + dx;
      const y = best.cy + dy;
      if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
      const i = y * gw + x;
      if (region.mask[i] > 0) filled[i] = 1;
      taken[i] = 1;
    }
    if (options.gap > 0) {
      for (const [dx, dy] of best.raster.edge) {
        for (let gy = -options.gap; gy <= options.gap; gy += 1) {
          for (let gx = -options.gap; gx <= options.gap; gx += 1) {
            const x = best.cx + dx + gx;
            const y = best.cy + dy + gy;
            if (x >= 0 && y >= 0 && x < gw && y < gh) taken[y * gw + x] = 1;
          }
        }
      }
    }
    sinceDistance += 1;
    placed.set(piece.id, {
      x: best.cx * region.scale + region.offsetX,
      y: best.cy * region.scale + region.offsetY,
      width: piece.width * best.shrink,
      height: piece.height * best.shrink,
      rotation: best.angle,
      shrink: best.shrink,
      clash: best.clash,
    });
  }

  let covered = 0;
  for (const value of filled) covered += value;
  return { placed, skipped, coverage: covered / regionCells };
}
