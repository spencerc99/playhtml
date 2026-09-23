// ABOUTME: Bakes a collage's placed pieces into a single PNG on a canvas.
// ABOUTME: Fetches remote scrap images as blobs so the canvas stays untainted.

import type { ScrapSnapshot } from "./collageRecord";
import type { CollageFrame, CollagePiece } from "./collageRecord";
import { sourceBoxForCrop, type CropFraction } from "./collageGeometry";
import { cutoutCanvas } from "./cutoutImages";
import { drawGrain } from "./paperGrain";
import { headingDisplayFontSize } from "@movement/components/ScrapCollage";
import { letteringLayout } from "./pieceLettering";
import {
  buttonBodyMarkup,
  foreignObjectDataUrl,
  headingBodyMarkup,
  requireXmlFragment,
  svgDataUrl,
} from "./svgDocument";

/**
 * The line height a heading is drawn at, rather than the one captured with its
 * font size, which would space wrapped lines far too far apart at display size.
 * Matches the shared renderer.
 */
const HEADING_LINE_HEIGHT = 1.15;

/** Names the pieces that could not be drawn, so a save can refuse to go ahead. */
export class CollageBakeError extends Error {
  readonly failures: BakeFailure[];

  constructor(failures: BakeFailure[]) {
    super(
      `${failures.length} piece${failures.length === 1 ? "" : "s"} could not be drawn`,
    );
    this.name = "CollageBakeError";
    this.failures = failures;
  }
}

export interface BakeFailure {
  pieceId: string;
  label: string;
  reason: string;
}

export async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "sync";
  image.src = source;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image failed to decode"));
  });
  return image;
}

/**
 * Loads a remote image through `fetch` so the bytes arrive as a same-origin
 * blob URL. The extension holds host permissions for all http/https, so this
 * keeps the canvas untainted where a plain crossorigin `<img>` would not.
 */
async function loadRemoteImage(src: string): Promise<HTMLImageElement> {
  if (src.startsWith("data:")) return loadImage(src);
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`fetch returned ${response.status}`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Draws a button scrap through an SVG foreignObject so it bakes as the thing
 * the studio shows, built from the same stored reconstruction `ScrapContent`
 * renders. Its lettering is set and scaled to the box exactly as the studio
 * sets it.
 */
async function loadButtonImage(
  scrap: Extract<ScrapSnapshot, { kind: "button" }>,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const layout = letteringLayout(scrap, { width, height });
  return loadImage(
    foreignObjectDataUrl({ body: buttonBodyMarkup(scrap), ...layout }),
  );
}

/**
 * Draws a heading scrap through the same foreignObject path a button takes, so
 * the page's own typography bakes into the picture. It is set at the display
 * font size `ScrapContent` gives it in the studio and scaled to the box with
 * the same layout, so the baked words match the piece at any size.
 */
async function loadHeadingImage(
  scrap: Extract<ScrapSnapshot, { kind: "heading" }>,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const layout = letteringLayout(scrap, { width, height });
  return loadImage(
    foreignObjectDataUrl({
      body: headingBodyMarkup(
        scrap,
        headingDisplayFontSize(scrap.styles, scrap.text),
        HEADING_LINE_HEIGHT,
      ),
      ...layout,
    }),
  );
}

async function loadSvgIconImage(
  markup: string,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const checked = requireXmlFragment(markup, "The icon");
  // An svg-icon is already an SVG document, so it needs no HTML wrapper; that
  // also keeps it clear of the foreignObject path entirely.
  return loadImage(svgDataUrl(sizedSvg(checked, width, height)));
}

/** Gives a serialized `<svg>` the box the piece was placed at. */
function sizedSvg(markup: string, width: number, height: number): string {
  return markup.replace(
    /^(\s*<svg\b)([^>]*)>/i,
    (_match, open: string, attributes: string) => {
      const withoutSize = attributes
        .replace(/\swidth\s*=\s*"[^"]*"/gi, "")
        .replace(/\sheight\s*=\s*"[^"]*"/gi, "");
      return `${open}${withoutSize} width="${width}" height="${height}">`;
    },
  );
}

function pieceLabel(scrap: ScrapSnapshot): string {
  switch (scrap.kind) {
    case "image":
      return scrap.alt?.trim() || `image from ${scrap.domain}`;
    case "button":
      return scrap.text.trim() || `button from ${scrap.domain}`;
    case "svg-icon":
      return `icon from ${scrap.domain}`;
    case "heading":
      return scrap.text.trim() || `heading from ${scrap.domain}`;
    case "cursor":
      return `cursor from ${scrap.domain}`;
  }
}

/**
 * What a piece draws. Most pieces draw their whole source; a cut-out image
 * draws only its cropped region, at `placement` within the source box.
 */
interface PieceImage {
  image: CanvasImageSource;
  placement?: CropFraction;
}

async function pieceImage(
  piece: CollagePiece,
  sourceWidth: number,
  sourceHeight: number,
): Promise<PieceImage> {
  const { scrap } = piece;
  switch (scrap.kind) {
    case "image": {
      if (!piece.cutout) return { image: await loadRemoteImage(scrap.src) };
      // A cut-out piece bakes from the same mask the studio shows, recomputed
      // over the piece's crop from the parameters the collage stored.
      const cut = await cutoutCanvas(scrap.src, piece.cutout, piece.crop);
      return { image: cut.canvas, placement: cut.placement };
    }
    case "cursor":
      return { image: await loadRemoteImage(scrap.url) };
    case "svg-icon":
      return {
        image: await loadSvgIconImage(scrap.markup, sourceWidth, sourceHeight),
      };
    case "button":
      return { image: await loadButtonImage(scrap, sourceWidth, sourceHeight) };
    case "heading":
      return {
        image: await loadHeadingImage(scrap, sourceWidth, sourceHeight),
      };
  }
}

export interface BakeOptions {
  frame: CollageFrame;
  pieces: readonly CollagePiece[];
  /** Pixel density of the baked PNG relative to the frame's logical size. */
  scale?: number;
  /** The paper the collage is made on, filled behind every piece. */
  paper: string;
  /** Whether the page's grain is laid over that paper, as the studio shows. */
  grain?: boolean;
}

/**
 * Draws the collage to a PNG. Throws `CollageBakeError` naming every piece that
 * could not be drawn, rather than leaving a hole in the saved image.
 */
export async function bakeCollage(options: BakeOptions): Promise<Blob> {
  const { frame, pieces } = options;
  const scale = options.scale ?? 2;

  const ordered = [...pieces].sort((a, b) => a.z - b.z);
  const failures: BakeFailure[] = [];
  const drawables = await Promise.all(
    ordered.map(async (piece) => {
      const source = sourceBoxForCrop(piece, piece.crop);
      try {
        const drawn = await pieceImage(
          piece,
          Math.max(1, Math.round(source.width)),
          Math.max(1, Math.round(source.height)),
        );
        return { piece, source, ...drawn };
      } catch (error) {
        failures.push({
          pieceId: piece.id,
          label: pieceLabel(piece.scrap),
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }),
  );

  if (failures.length > 0) throw new CollageBakeError(failures);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frame.width * scale);
  canvas.height = Math.round(frame.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get a 2d drawing context for the collage");
  }
  context.scale(scale, scale);
  context.fillStyle = options.paper;
  context.fillRect(0, 0, frame.width, frame.height);
  // The grain goes on before the pieces, so it is the paper they sit on rather
  // than a wash over the finished collage.
  if (options.grain) await drawGrain(context, frame.width, frame.height);
  context.imageSmoothingQuality = "high";

  for (const drawable of drawables) {
    if (!drawable) continue;
    const { piece, source, image, placement } = drawable;
    const centerX = piece.x + piece.width / 2;
    const centerY = piece.y + piece.height / 2;
    context.save();
    context.translate(centerX, centerY);
    context.rotate((piece.rotation * Math.PI) / 180);
    // The mirror happens about the piece's own center, inside its box, so a
    // flipped piece keeps its place, its angle and its crop window.
    if (piece.flipX || piece.flipY) {
      context.scale(piece.flipX ? -1 : 1, piece.flipY ? -1 : 1);
    }
    context.translate(-centerX, -centerY);
    // The crop is a clip of the rendered piece, so the whole source is drawn
    // and the visible box masks it — identical to how the studio shows it.
    context.beginPath();
    context.rect(piece.x, piece.y, piece.width, piece.height);
    context.clip();
    if (placement) {
      context.drawImage(
        image,
        source.x + placement.x * source.width,
        source.y + placement.y * source.height,
        placement.width * source.width,
        placement.height * source.height,
      );
    } else {
      context.drawImage(image, source.x, source.y, source.width, source.height);
    }
    context.restore();
  }

  return canvasPng(canvas, "The collage canvas produced no image");
}

/** Reads a finished canvas out as a PNG, or throws with the given words. */
export async function canvasPng(
  canvas: HTMLCanvasElement,
  emptyMessage: string,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    try {
      // A tainted canvas rejects here rather than handing back a silent hole.
      canvas.toBlob(resolve, "image/png");
    } catch (error) {
      reject(error);
    }
  });
  if (!blob) {
    throw new Error(emptyMessage);
  }
  return blob;
}
