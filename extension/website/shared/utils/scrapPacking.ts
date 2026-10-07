// ABOUTME: Packs scraps at their own sizes into a field, newest first, one visit at a time.
// ABOUTME: A visit is a run of scraps from one page; each packs as a cluster, then clusters fill top-down.

import type { ScrapItem } from "../components/ScrapCollage";

export interface PackOptions {
  /** How wide the field is, in pixels. */
  width: number;
  seed: number;
  /** Largest a scrap's long edge is drawn, in pixels. */
  maxEdge: number;
  /** Smallest a scrap's long edge is drawn, in pixels. */
  minEdge: number;
  /**
   * How much a scrap's recorded size is flattened before drawing. 1 keeps the
   * spread between tiny and huge; lower values pull them toward each other.
   */
  squash: number;
  /** Multiplier on every scrap's drawn size. */
  scale: number;
  /** Space between scraps inside one visit. */
  gap: number;
  /** Space between one visit and the next. */
  visitGap: number;
  /**
   * How far above the last visit's top a later visit may tuck in. Keeps the
   * field reading newest-first instead of letting small things fill old gaps.
   */
  backtrack: number;
  /** Largest tilt either way, in degrees. */
  tilt: number;
  /**
   * Measures a run of text in a CSS font, so buttons get boxes that fit their
   * words. Without it, text width is estimated from its length.
   */
  measureText?: (text: string, font: string) => number;
  /**
   * `visits` packs each visit as a rigid cluster and places the clusters;
   * `pieces` places every scrap on its own, near the rest of its visit.
   */
  placement: "visits" | "pieces";
}

export const DEFAULT_PACK_OPTIONS: Omit<
  PackOptions,
  "width" | "seed" | "measureText"
> = {
  maxEdge: 240,
  minEdge: 22,
  squash: 0.8,
  scale: 1,
  gap: 4,
  visitGap: 12,
  backtrack: 200,
  tilt: 4,
  placement: "pieces",
};

export interface PackedScrap {
  item: ScrapItem;
  visit: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PackedVisit {
  items: ScrapItem[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Packing {
  scraps: PackedScrap[];
  visits: PackedVisit[];
  height: number;
}

/** Occupancy is tracked on a coarse grid; finer is tighter but slower. */
const CELL = 4;
/** A search that runs this many rows without a fit has a bug, not a full field. */
const MAX_SCAN_ROWS = 200_000;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable number in [0, 1) for one scrap, so a layout never reshuffles. */
function seeded(seed: number, key: string, salt: number): number {
  let value = hashString(`${seed}:${key}:${salt}`);
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

/** Room a scrap needs beside it so its visit still fits inside the field. */
function maxSpare(options: PackOptions): number {
  return options.gap * 2 + CELL * 4;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Splits a newest-first list into visits: each run of consecutive scraps from
 * the same page. Coming back to a page after going elsewhere starts a new one.
 */
export function groupVisits(items: readonly ScrapItem[]): ScrapItem[][] {
  const visits: ScrapItem[][] = [];
  for (const item of items) {
    const current = visits[visits.length - 1];
    if (current && current[0].pageUrl === item.pageUrl) current.push(item);
    else visits.push([item]);
  }
  return visits;
}

/**
 * The size a scrap was on its page, as best as it was recorded. Images carry
 * their file's pixel size; buttons are estimated from their text and type.
 */
export function recordedSize(
  item: ScrapItem,
  measureText?: PackOptions["measureText"],
): { width: number; height: number } {
  switch (item.kind) {
    case "image":
      return { width: item.naturalWidth, height: item.naturalHeight };
    case "svg-icon":
      return { width: item.width, height: item.height };
    case "button": {
      const fontSize = Number.parseFloat(item.styles.fontSize ?? "") || 14;
      const padX =
        (Number.parseFloat(item.styles.paddingLeft ?? "") || 0) +
        (Number.parseFloat(item.styles.paddingRight ?? "") || 0);
      const padY =
        (Number.parseFloat(item.styles.paddingTop ?? "") || 0) +
        (Number.parseFloat(item.styles.paddingBottom ?? "") || 0);
      const iconRoom = item.innerSvg ? fontSize * 1.45 : 0;
      const text = item.text.trim();
      const font = `${item.styles.fontStyle ?? "normal"} ${item.styles.fontWeight ?? "400"} ${fontSize}px ${item.styles.fontFamily ?? "sans-serif"}`;
      const textWidth = measureText
        ? measureText(text, font)
        : text.length * fontSize * 0.58;
      return {
        width: textWidth + padX + iconRoom + 6,
        height: fontSize * 1.25 + padY + 4,
      };
    }
    case "heading": {
      const fontSize = Number.parseFloat(item.styles.fontSize ?? "") || 24;
      return {
        width: item.text.trim().length * fontSize * 0.55 + 16,
        height: fontSize * 1.2 + 12,
      };
    }
    case "cursor":
      return { width: 40, height: 40 };
  }
}

/**
 * How big a scrap is drawn: its recorded size with the long edge flattened by
 * `squash`, scaled, nudged a little per scrap, and kept between the bounds.
 * Words (buttons, headings) keep their recorded size so they stay legible.
 */
export function drawnSize(
  item: ScrapItem,
  options: PackOptions,
): { width: number; height: number } {
  const recorded = recordedSize(item, options.measureText);
  if (
    !Number.isFinite(recorded.width) ||
    !Number.isFinite(recorded.height) ||
    recorded.width <= 0 ||
    recorded.height <= 0
  ) {
    throw new Error(`Scrap ${item.id} has no usable size`);
  }
  if (item.kind === "button" || item.kind === "heading") {
    const width = Math.min(recorded.width * options.scale, options.width - maxSpare(options));
    return { width, height: recorded.height * options.scale };
  }
  if (item.kind === "cursor") return recorded;
  if (item.kind === "svg-icon") {
    // An icon's recorded size is the size it was drawn on its page, so it is
    // kept as-is rather than flattened like an image file's pixel size.
    // Tiny ones are grown to stay visible; huge ones still obey the bounds.
    const grow = Math.max(1, 14 / Math.min(recorded.width, recorded.height));
    const shrink = Math.min(
      1,
      Math.min(options.maxEdge, options.width - maxSpare(options)) /
        (Math.max(recorded.width, recorded.height) * grow * options.scale),
    );
    return {
      width: recorded.width * grow * options.scale * shrink,
      height: recorded.height * grow * options.scale * shrink,
    };
  }

  const longEdge = Math.max(recorded.width, recorded.height);
  const nudge = 0.9 + seeded(options.seed, item.key, 1) * 0.2;
  const drawnLong = clamp(
    options.minEdge,
    Math.min(options.maxEdge, options.width - maxSpare(options)),
    Math.pow(longEdge, options.squash) * options.scale * nudge,
  );
  const ratio = drawnLong / longEdge;
  return { width: recorded.width * ratio, height: recorded.height * ratio };
}

/** Which grid cells are taken. Grows downward as the field fills. */
class Occupancy {
  readonly columns: number;
  private rows: number;
  private cells: Uint8Array;

  constructor(width: number) {
    this.columns = Math.max(1, Math.ceil(width / CELL));
    this.rows = 256;
    this.cells = new Uint8Array(this.columns * this.rows);
  }

  private ensureRows(rows: number) {
    if (rows <= this.rows) return;
    let next = this.rows;
    while (next < rows) next *= 2;
    const grown = new Uint8Array(this.columns * next);
    grown.set(this.cells);
    this.cells = grown;
    this.rows = next;
  }

  /** True when every cell the box covers is free. Box is in cells. */
  free(column: number, row: number, columns: number, rows: number): boolean {
    if (column < 0 || column + columns > this.columns || row < 0) return false;
    this.ensureRows(row + rows);
    for (let r = row; r < row + rows; r += 1) {
      const base = r * this.columns;
      for (let c = column; c < column + columns; c += 1) {
        if (this.cells[base + c]) return false;
      }
    }
    return true;
  }

  take(column: number, row: number, columns: number, rows: number) {
    const from = Math.max(0, column);
    const to = Math.min(this.columns, column + columns);
    const top = Math.max(0, row);
    this.ensureRows(row + rows);
    for (let r = top; r < row + rows; r += 1) {
      this.cells.fill(1, r * this.columns + from, r * this.columns + to);
    }
  }
}

interface CellBox {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

/** A box in pixels becomes the cells it touches, grown by a margin. */
function toCells(x: number, y: number, width: number, height: number, margin: number): CellBox {
  const column = Math.floor((x - margin) / CELL);
  const row = Math.floor((y - margin) / CELL);
  return {
    column,
    row,
    columns: Math.ceil((x + width + margin) / CELL) - column,
    rows: Math.ceil((y + height + margin) / CELL) - row,
  };
}

interface Piece {
  item: ScrapItem;
  width: number;
  height: number;
  /** Offset inside the visit's cluster. */
  x: number;
  y: number;
}

/**
 * Packs one visit's scraps into a loose cluster, largest first: each takes
 * the highest free spot that fits, reading left to right. The cluster's width is
 * about what a square-ish blob of its total area would need.
 */
function packVisit(items: ScrapItem[], options: PackOptions): {
  pieces: Piece[];
  width: number;
  height: number;
} {
  // Biggest first packs a visit tightly; the visit as a whole still keeps its
  // place in time, and within one visit everything happened moments apart.
  const sized = items
    .map((item) => ({ item, ...drawnSize(item, options) }))
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const area = sized.reduce((sum, piece) => sum + piece.width * piece.height, 0);
  // A piece's footprint in the grid is its box, its gap, and rounding to
  // cells; the cluster is never narrower than the widest footprint.
  const widestFootprint = Math.max(
    ...sized.map(
      (piece) =>
        toCells(0, 0, piece.width, piece.height, options.gap / 2).columns * CELL,
    ),
  );
  const clusterWidth = clamp(
    widestFootprint,
    Math.max(widestFootprint, options.width),
    Math.sqrt(area * 1.5) * 1.15,
  );

  const grid = new Occupancy(clusterWidth);
  const pieces: Piece[] = [];
  let right = 0;
  let bottom = 0;
  for (const piece of sized) {
    const box = toCells(0, 0, piece.width, piece.height, options.gap / 2);
    let placed: { column: number; row: number } | null = null;
    for (let row = 0; !placed; row += 1) {
      if (row > MAX_SCAN_ROWS) {
        throw new Error(`Scrap ${piece.item.id} found no room in its visit`);
      }
      for (let column = 0; column + box.columns <= grid.columns; column += 1) {
        if (grid.free(column, row, box.columns, box.rows)) {
          placed = { column, row };
          break;
        }
      }
    }
    grid.take(placed.column, placed.row, box.columns, box.rows);
    const x = placed.column * CELL + options.gap / 2;
    const y = placed.row * CELL + options.gap / 2;
    pieces.push({ ...piece, x, y });
    right = Math.max(right, x + piece.width);
    bottom = Math.max(bottom, y + piece.height);
  }
  return { pieces, width: right, height: bottom };
}

/**
 * Who holds each grid cell: nobody, a scrap, or the margin around a visit.
 * A visit's own margin is open to its own scraps, so pieces of one visit sit
 * close while different visits keep apart.
 */
class Territory {
  readonly columns: number;
  private rows: number;
  private cells: Int32Array;
  static readonly TAKEN = -1;

  constructor(width: number) {
    this.columns = Math.max(1, Math.ceil(width / CELL));
    this.rows = 256;
    this.cells = new Int32Array(this.columns * this.rows);
  }

  private ensureRows(rows: number) {
    if (rows <= this.rows) return;
    let next = this.rows;
    while (next < rows) next *= 2;
    const grown = new Int32Array(this.columns * next);
    grown.set(this.cells);
    this.cells = grown;
    this.rows = next;
  }

  /** True when a cell is held by a scrap or by some other visit's margin. */
  blocked(row: number, column: number, visitTag: number): boolean {
    const cell = this.cells[row * this.columns + column];
    return cell !== 0 && cell !== visitTag;
  }

  /** Makes sure rows up to `rows` exist before a run of `blocked` reads. */
  reserve(rows: number) {
    this.ensureRows(rows);
  }

  /** Marks the box, overwriting anything; `onlyFree` leaves claimed cells be. */
  mark(box: CellBox, tag: number, onlyFree: boolean) {
    const from = Math.max(0, box.column);
    const to = Math.min(this.columns, box.column + box.columns);
    const top = Math.max(0, box.row);
    this.ensureRows(box.row + box.rows);
    for (let r = top; r < box.row + box.rows; r += 1) {
      const base = r * this.columns;
      for (let c = from; c < to; c += 1) {
        if (!onlyFree || this.cells[base + c] === 0) this.cells[base + c] = tag;
      }
    }
  }
}

/** How many rows past the first fit a piece looks for a spot nearer its visit. */
const NEARBY_ROWS = 24;

/**
 * Places every scrap on its own, visit by visit in time order. A visit's
 * first scrap takes the highest open spot; the rest take whichever open spot
 * near that height sits closest to the visit so far.
 */
function packPieces(items: readonly ScrapItem[], options: PackOptions): Packing {
  const grid = new Territory(options.width);
  const scraps: PackedScrap[] = [];
  const visits: PackedVisit[] = [];
  let floor = 0;
  let height = 0;
  const halfGap = options.gap / 2;

  for (const visitItems of groupVisits(items)) {
    const visit = visits.length;
    const tag = visit + 1;
    const sized = visitItems
      .map((item) => ({ item, ...drawnSize(item, options) }))
      .sort((a, b) => b.width * b.height - a.width * a.height);
    let bounds: { left: number; top: number; right: number; bottom: number } | null =
      null;
    let visitFloor = 0;

    for (const piece of sized) {
      const size = toCells(0, 0, piece.width, piece.height, halfGap);
      if (size.columns > grid.columns) {
        throw new Error(`Scrap ${piece.item.id} is wider than the field`);
      }
      // A long visit keeps moving down the field as it fills, so each piece
      // starts looking near where the visit's last piece went, not its top.
      const startRow = Math.max(
        0,
        Math.floor((Math.max(floor, visitFloor) - options.backtrack) / CELL),
      );
      const boxAt = (column: number, row: number): CellBox => ({
        column,
        row,
        columns: size.columns,
        rows: size.rows,
      });

      // Scan rows downward. For the band of rows a box at `row` would cover,
      // `columnBlocked[c]` counts blocked cells in column c; sliding a window
      // of the box's width across it finds every open spot in the row at once.
      const reach = Math.ceil(options.maxEdge / CELL);
      const fromColumn: number = bounds
        ? Math.max(0, Math.floor(bounds.left / CELL) - size.columns - reach)
        : 0;
      const toColumn: number = bounds
        ? Math.min(grid.columns - size.columns, Math.ceil(bounds.right / CELL) + reach)
        : grid.columns - size.columns;
      const spanEnd = toColumn + size.columns;
      const columnBlocked = new Int32Array(grid.columns);
      grid.reserve(startRow + size.rows);
      for (let r = startRow; r < startRow + size.rows; r += 1) {
        for (let c = fromColumn; c < spanEnd; c += 1) {
          if (grid.blocked(r, c, tag)) columnBlocked[c] += 1;
        }
      }

      let best: { column: number; row: number; score: number } | null = null;
      let firstRow = -1;
      for (let row = startRow; ; row += 1) {
        if (row > startRow + MAX_SCAN_ROWS) {
          throw new Error(`Scrap ${piece.item.id} found no room`);
        }
        if (firstRow >= 0 && row > firstRow + NEARBY_ROWS) break;
        if (row > startRow) {
          grid.reserve(row + size.rows);
          for (let c = fromColumn; c < spanEnd; c += 1) {
            if (grid.blocked(row - 1, c, tag)) columnBlocked[c] -= 1;
            if (grid.blocked(row + size.rows - 1, c, tag)) columnBlocked[c] += 1;
          }
        }
        let windowBlocked = 0;
        for (let c = fromColumn; c < fromColumn + size.columns; c += 1) {
          windowBlocked += columnBlocked[c];
        }
        for (let column: number = fromColumn; column <= toColumn; column += 1) {
          if (column > fromColumn) {
            windowBlocked +=
              columnBlocked[column + size.columns - 1] - columnBlocked[column - 1];
          }
          if (windowBlocked !== 0) continue;
          if (firstRow < 0) firstRow = row;
          if (!bounds) {
            best = { column, row, score: 0 };
            break;
          }
          const centerX = (column + size.columns / 2) * CELL;
          const centerY = (row + size.rows / 2) * CELL;
          const nearestX = clamp(bounds.left, bounds.right, centerX);
          const nearestY = clamp(bounds.top, bounds.bottom, centerY);
          const score =
            Math.abs(centerX - nearestX) + Math.abs(centerY - nearestY) + row * CELL * 0.25;
          if (!best || score < best.score) best = { column, row, score };
        }
        if (best && !bounds) break;
      }
      if (!best) throw new Error(`Scrap ${piece.item.id} found no room`);

      const x: number = best.column * CELL + halfGap;
      const y: number = best.row * CELL + halfGap;
      grid.mark(boxAt(best.column, best.row), Territory.TAKEN, false);
      grid.mark(
        toCells(x, y, piece.width, piece.height, options.visitGap),
        tag,
        true,
      );
      scraps.push({
        item: piece.item,
        visit,
        x,
        y,
        width: piece.width,
        height: piece.height,
        rotation: (seeded(options.seed, piece.item.key, 2) * 2 - 1) * options.tilt,
      });
      bounds = bounds
        ? {
            left: Math.min(bounds.left, x),
            top: Math.min(bounds.top, y),
            right: Math.max(bounds.right, x + piece.width),
            bottom: Math.max(bounds.bottom, y + piece.height),
          }
        : { left: x, top: y, right: x + piece.width, bottom: y + piece.height };
      height = Math.max(height, y + piece.height);
      visitFloor = Math.max(visitFloor, y);
    }

    if (!bounds) throw new Error("A visit had no scraps");
    visits.push({
      items: visitItems,
      x: bounds.left,
      y: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    });
    floor = Math.max(floor, bounds.top);
  }

  return { scraps, visits, height };
}

/**
 * Lays every visit into the field in order. A visit takes the highest spot
 * where all of its pieces fit, scanning left to right, but never more than
 * `backtrack` above the highest visit placed so far.
 */
export function packScraps(
  items: readonly ScrapItem[],
  options: PackOptions,
): Packing {
  if (options.placement === "pieces") return packPieces(items, options);
  const grid = new Occupancy(options.width);
  const scraps: PackedScrap[] = [];
  const visits: PackedVisit[] = [];
  let floor = 0;
  let height = 0;

  for (const visitItems of groupVisits(items)) {
    const cluster = packVisit(visitItems, options);
    const boxes = cluster.pieces.map((piece) =>
      toCells(piece.x, piece.y, piece.width, piece.height, 0),
    );
    const clusterColumns = Math.ceil(cluster.width / CELL);
    const fits = (column: number, row: number) =>
      boxes.every((box) =>
        grid.free(column + box.column, row + box.row, box.columns, box.rows),
      );

    const startRow = Math.max(0, Math.floor((floor - options.backtrack) / CELL));
    let spot: { column: number; row: number } | null = null;
    if (clusterColumns > grid.columns) {
      throw new Error(
        `A visit of ${visitItems.length} scraps is wider than the field`,
      );
    }
    for (let row = startRow; !spot; row += 1) {
      if (row > startRow + MAX_SCAN_ROWS) {
        throw new Error(`A visit starting ${visitItems[0].id} found no room`);
      }
      for (let column = 0; column + clusterColumns <= grid.columns + 1; column += 1) {
        if (fits(column, row)) {
          spot = { column, row };
          break;
        }
      }
    }

    const originX = spot.column * CELL;
    const originY = spot.row * CELL;
    const visit = visits.length;
    for (const piece of cluster.pieces) {
      const x = originX + piece.x;
      const y = originY + piece.y;
      const margin = toCells(x, y, piece.width, piece.height, options.visitGap);
      grid.take(margin.column, margin.row, margin.columns, margin.rows);
      scraps.push({
        item: piece.item,
        visit,
        x,
        y,
        width: piece.width,
        height: piece.height,
        rotation: (seeded(options.seed, piece.item.key, 2) * 2 - 1) * options.tilt,
      });
      height = Math.max(height, y + piece.height);
    }
    visits.push({
      items: visitItems,
      x: originX,
      y: originY,
      width: cluster.width,
      height: cluster.height,
    });
    floor = Math.max(floor, originY);
  }

  return { scraps, visits, height };
}
