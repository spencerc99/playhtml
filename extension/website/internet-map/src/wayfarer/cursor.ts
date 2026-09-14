// ABOUTME: The walking character drawn as the person's own cursor, in their colour, chunky like the map.
// ABOUTME: The arrow is the same shape playhtml gives every cursor, rasterised small and scaled up unsmoothed.

/**
 * A cursor is the one shape everyone already reads as "me". The arrow here is
 * playhtml's cursor arrow, path for path: a white body with the person's
 * colour inside it. It is drawn at a handful of pixels and blown up without
 * smoothing, so on a map made of glyphs it comes out blocky rather than
 * glossy, but the silhouette is still unmistakably the default cursor.
 */

/** playhtml's cursor arrow: white body, then the coloured fill, in a 18x18 box at (10,9). */
const BODY = [
  "m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z",
  "m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z",
];
const INK = [
  "m19.751 24.4155-1.844.774-3.1-7.374 1.841-.775z",
  "m13 10.814v11.188l2.969-2.866.428-.139h4.768z",
];
const BOX = 18;
const BOX_X = 10, BOX_Y = 9;
/** the tip of the arrow, in box units, so the walker's position is the point */
const TIP_X = 12 - BOX_X, TIP_Y = 8.4 - BOX_Y;

/** How many pixels the arrow is drawn at before scaling: the coarseness of the look. */
const SPRITE_PX = 13;

/**
 * Only colours a cursor can actually have: hex, rgb() or hsl(). The value
 * arrives from a URL or a message, and it ends up as a canvas fillStyle, so
 * anything else is refused rather than trusted.
 */
export function parseCursorColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  if (/^(?:rgb|hsl)a?\(\s*[\d.]+(?:deg)?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.test(v)) {
    return v;
  }
  return null;
}

export class CursorSprite {
  private cache = new Map<string, HTMLCanvasElement>();

  /** The arrow rasterised once per colour at SPRITE_PX, blocky by construction. */
  private sprite(color: string): HTMLCanvasElement {
    let cv = this.cache.get(color);
    if (cv) return cv;
    cv = document.createElement("canvas");
    cv.width = SPRITE_PX; cv.height = SPRITE_PX;
    const c = cv.getContext("2d")!;
    c.scale(SPRITE_PX / BOX, SPRITE_PX / BOX);
    c.translate(-BOX_X, -BOX_Y);
    const fill = (paths: string[], colour: string) => {
      c.fillStyle = colour;
      for (const d of paths) c.fill(new Path2D(d));
    };
    // the faint shadow the real cursor casts, one step down and right
    c.save(); c.translate(1, 1); fill(BODY, "rgba(0,0,0,0.2)"); c.restore();
    fill(BODY, "#ffffff");
    fill(INK, color);
    this.cache.set(color, cv);
    return cv;
  }

  /**
   * Draw the cursor with its tip at (x, y), `size` px tall. Scaling is done
   * by the canvas with smoothing off, so every sprite pixel becomes a crisp
   * block whatever the zoom.
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
    const s = this.sprite(color);
    const scale = size / SPRITE_PX;
    // snap to whole blocks so the arrow never shimmers between frames
    const px = Math.max(1, Math.round(scale));
    const w = SPRITE_PX * px;
    const ox = Math.round(x - (TIP_X / BOX) * w);
    const oy = Math.round(y - (TIP_Y / BOX) * w);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s, ox, oy, w, w);
    ctx.restore();
  }
}
