// ABOUTME: Packs settled click marks into a bounded set of shared bitmap pages.
// ABOUTME: Reuses released slots as older marks leave the visualization.
const PAGE_SIZE = 1024;
const MAX_PAGES = 8;
const ALIGNMENT = 4;

export interface CachedClickMark {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Page {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  rows: Array<{ y: number; height: number; nextX: number }>;
  nextY: number;
}

export class ClickMarkCache {
  private pages: Page[] = [];
  private free = new Map<string, CachedClickMark[]>();

  get byteLength() {
    return this.pages.length * PAGE_SIZE * PAGE_SIZE * 4;
  }

  store(
    source: HTMLCanvasElement,
    width: number,
    height: number,
  ): CachedClickMark | undefined {
    const w = Math.ceil(width / ALIGNMENT) * ALIGNMENT;
    const h = Math.ceil(height / ALIGNMENT) * ALIGNMENT;
    if (w > PAGE_SIZE || h > PAGE_SIZE) return;
    const key = `${w}:${h}`;
    const available = this.free.get(key)?.pop();
    let page = available
      ? this.pages.find((page) => page.canvas === available.canvas)
      : undefined;
    let slot = available;
    if (!slot) {
      for (const candidate of this.pages) {
        let row = candidate.rows.find(
          (row) => row.height === h && row.nextX + w <= PAGE_SIZE,
        );
        if (!row && candidate.nextY + h <= PAGE_SIZE) {
          row = { y: candidate.nextY, height: h, nextX: 0 };
          candidate.rows.push(row);
          candidate.nextY += h;
        }
        if (row) {
          page = candidate;
          slot = {
            canvas: page.canvas,
            x: row.nextX,
            y: row.y,
            width: w,
            height: h,
          };
          row.nextX += w;
          break;
        }
      }
    }
    if (!slot && this.pages.length < MAX_PAGES) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = PAGE_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Click residue requires Canvas 2D");
      page = {
        canvas,
        context,
        rows: [{ y: 0, height: h, nextX: w }],
        nextY: h,
      };
      this.pages.push(page);
      slot = { canvas, x: 0, y: 0, width: w, height: h };
    }
    if (!slot || !page) return;
    page.context.clearRect(slot.x, slot.y, w, h);
    page.context.drawImage(
      source,
      0,
      0,
      width,
      height,
      slot.x,
      slot.y,
      width,
      height,
    );
    return slot;
  }

  release(slot: CachedClickMark) {
    const key = `${slot.width}:${slot.height}`;
    let slots = this.free.get(key);
    if (!slots) {
      slots = [];
      this.free.set(key, slots);
    }
    slots.push(slot);
  }

  clear() {
    for (const page of this.pages) page.canvas.width = page.canvas.height = 0;
    this.pages = [];
    this.free.clear();
  }
}
