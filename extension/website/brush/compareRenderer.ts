// ABOUTME: Renders the sample trails once per brush through a SINGLE p5/WebGL instance.
// ABOUTME: Each finished tile is copied into a plain 2D canvas, so tile count never costs a GL context.

import p5 from "p5";
import * as brush from "p5.brush";
import { SampleTrail } from "./sampleTrails";
import { effectiveWeight, BRUSH_SCALE } from "./brushCatalog";
import { renderSettledSprite } from "./rippleOverlay";
import { ClickStyle, PressureMode } from "./sketch";

export interface CompareOptions {
  weight: number;
  pressureMode: PressureMode;
  clickStyle: ClickStyle;
}

/**
 * Click marks on the sheet are drawn larger than in the live replay. There the
 * marks sit at cursor scale among thousands of others; here there are six on a
 * 600px tile, and each one has to be big enough to judge on its own.
 */
const CLICK_RADIUS = 16;

/**
 * Tile key for the "pastel + current clicks" panel. It renders pastel strokes
 * and NO brush click marks, because that tile's clicks are the production
 * ripples drawn in a separate overlay above the ink.
 */
export const PASTEL_TILE_KEY = "pastel+ripples";

export interface CompareTileResult {
  brushName: string;
  /** The weight actually passed to brush.set(), for the tile label. */
  appliedWeight: number;
  error: string | null;
}

const BACKGROUND = "#faf7f2";
const FAST_PX_PER_MS = 2.5;

function pressureFor(
  mode: PressureMode,
  a: { x: number; y: number; ts: number },
  b: { x: number; y: number; ts: number },
): number {
  if (mode === "constant") return 1;
  const dt = Math.max(1, b.ts - a.ts);
  const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
  return 1.4 - Math.min(1, speed / FAST_PX_PER_MS) * 1.05;
}

/**
 * Draw every brush's version of the sample into `targets`, one entry per brush,
 * reusing one hidden WebGL canvas. Resolves once all tiles are painted.
 *
 * p5.brush rasterizes asynchronously, so each brush gets a frame to settle
 * before its pixels are copied out.
 */
export function renderCompareTiles(
  brushNames: string[],
  sample: SampleTrail[],
  targets: Map<string, HTMLCanvasElement>,
  width: number,
  height: number,
  options: CompareOptions,
  onDone: (results: CompareTileResult[]) => void,
): () => void {
  // The scratch canvas must stay genuinely on-screen: a browser throttles or
  // skips rendering for a canvas it considers invisible, which stalls the
  // draw/copy cycle. It is clipped to a single pixel in the corner instead of
  // hidden, so it keeps animating without being visible to the reader.
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;" +
    "opacity:0.01;pointer-events:none;z-index:0;";
  document.body.appendChild(host);

  const results: CompareTileResult[] = [];
  let disposed = false;
  let instance: p5 | null = null;

  const sketch = (p: p5) => {
    brush.instance(p);

    let ink: p5.Graphics;

    // Center-origin conversion: p5.brush ignores p5's translate for strokes.
    const cx = (x: number) => x - width / 2;
    const cy = (y: number) => y - height / 2;

    const drawClick = (
      click: { x: number; y: number },
      color: string,
      weight: number,
    ) => {
      brush.noFill();
      brush.noHatch();
      const x = cx(click.x);
      const y = cy(click.y);

      const r = CLICK_RADIUS;

      if (options.clickStyle === "spray") {
        brush.set("spray", color, effectiveWeight("spray", weight) * 2.2);
        // A tight scribble under the spray tip reads as a stippled dab.
        brush.beginStroke("curve", x - r * 0.4, y);
        brush.move(0, r * 0.8, 0.9);
        brush.move(Math.PI * 0.8, r * 0.9, 0.7);
        brush.endStroke(Math.PI * 1.5, 0.5);
        return;
      }

      if (options.clickStyle === "hatch") {
        // Hatched by hand; the library's hatch() needs a brush 2.2.3 lacks.
        brush.set("2H", color, effectiveWeight("2H", weight));
        brush.circle(x, y, r, 0.4);
        for (let offset = -r; offset <= r; offset += 3.5) {
          const half = Math.sqrt(Math.max(0, r * r - offset * offset));
          if (half < 0.5) continue;
          const ox = offset * Math.SQRT1_2;
          const oy = -offset * Math.SQRT1_2;
          const d = half * Math.SQRT1_2;
          brush.line(x + ox - d, y + oy - d, x + ox + d, y + oy + d);
        }
        return;
      }

      brush.noStroke();
      brush.fillBleed(0.3, "out");
      brush.fillTexture(0.55, 0.4);
      brush.fill(color, 110);
      brush.circle(x, y, r, 0.6);
      brush.noFill();
      brush.stroke(color);
    };

    p.setup = () => {
      p.createCanvas(width, height, p.WEBGL);
      p.pixelDensity(1);
      // Ink goes into a buffer, not the main canvas: p5 clears the main WebGL
      // canvas every frame, so a tile drawn on one frame is already gone by the
      // frame that would copy it out.
      ink = p.createGraphics(width, height, p.WEBGL);
      ink.pixelDensity(1);
      brush.load(ink);
      // Must match the replay page exactly; see BRUSH_SCALE.
      brush.scaleBrushes(BRUSH_SCALE);
      brush.noField();
      // rAF is throttled to a standstill whenever the document is hidden, so
      // frames are pumped from a timer instead and p5's own loop stays off.
      p.noLoop();
      pump();
    };

    // p5.brush rasterizes its stamps asynchronously, so a tile can only be
    // copied on the step AFTER it was drawn. The pump therefore alternates
    // draw and copy, one brush at a time.
    let index = 0;
    let phase: "draw" | "copy" = "draw";

    const pump = () => {
      if (disposed || index >= brushNames.length) return;
      window.setTimeout(() => {
        if (disposed) return;
        // redraw() runs p.draw once synchronously, so each step goes through
        // p5's real frame path (and p5.brush's flush) without needing rAF.
        p.redraw();
        pump();
      }, 32);
    };

    p.draw = () => {
      if (disposed || index >= brushNames.length) return;
      const brushName = brushNames[index];

      if (phase === "draw") {
        ink.background(BACKGROUND);
        // The pastel tile is a pastel pass whose clicks come from the overlay.
        const isPastelTile = brushName === PASTEL_TILE_KEY;
        const drawnBrush = isPastelTile ? "pastel" : brushName;
        const applied = effectiveWeight(drawnBrush, options.weight);
        let error: string | null = null;

        for (const trail of sample) {
          // Time order: this trail's clicks settled BEFORE the trail that comes
          // next, so their residue is stamped now and later strokes cover it,
          // the way marks layer on paper.
          if (isPastelTile) {
            for (const click of trail.clicks) {
              const sprite = renderSettledSprite(click.x, click.y, trail.color);
              if (!sprite) continue;
              // p5's WEBGL renderer cannot texture a bare HTMLCanvasElement,
              // so the sprite is copied into a p5.Image first.
              const image = p.createImage(
                sprite.canvas.width,
                sprite.canvas.height,
              );
              (
                image as unknown as { drawingContext: CanvasRenderingContext2D }
              ).drawingContext.drawImage(sprite.canvas, 0, 0);
              ink.image(
                image,
                sprite.left - width / 2,
                sprite.top - height / 2,
              );
            }
          }

          try {
            brush.noFill();
            brush.noHatch();
            brush.set(drawnBrush, trail.color, applied);
            // spline() takes absolute control points, so every tile traces the
            // exact same geometry as the SVG tile. The angle/length form of
            // beginStroke+move accumulates drift over a long path and would
            // make each tile a slightly different drawing.
            const controls = trail.points.map((point, i) => {
              const previous = trail.points[i === 0 ? 0 : i - 1];
              return [
                cx(point.x),
                cy(point.y),
                pressureFor(options.pressureMode, previous, point),
              ];
            });
            brush.spline(controls, 0.4);
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }

          if (!isPastelTile) {
            for (const click of trail.clicks) {
              try {
                drawClick(click, trail.color, options.weight);
              } catch (err) {
                error = err instanceof Error ? err.message : String(err);
              }
            }
          }
        }

        results.push({ brushName, appliedWeight: applied, error });
        phase = "copy";
        return;
      }

      // Copy phase: last step's stamps have landed in the buffer by now.
      const target = targets.get(brushName);
      if (target) {
        const ctx = target.getContext("2d");
        if (ctx) {
          target.width = width;
          target.height = height;
          const source = (ink.drawingContext as WebGL2RenderingContext).canvas;
          ctx.drawImage(source as HTMLCanvasElement, 0, 0);
        }
      }
      index++;
      phase = "draw";
      // Report only once everything is painted. Reporting per tile would
      // re-render the grid mid-run and swap out the very canvases still
      // being copied into.
      if (index >= brushNames.length) onDone([...results]);
    };
  };

  instance = new p5(sketch, host);

  return () => {
    disposed = true;
    instance?.remove();
    host.remove();
  };
}
