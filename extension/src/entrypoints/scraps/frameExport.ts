// ABOUTME: Mounts an exported collage picture on the studio's mat, caption and all.
// ABOUTME: The caption names the collage, its piece count and date, and signs it "we were online".

/** The mat's border and caption band, as fractions of the picture's width. */
const MAT_SHARE = 0.032;
const CAPTION_SHARE = 0.056;

const MAT_COLOR = "#e6e3dc";
const INK = "#3a3734";
const MUTED = "#86807a";
const RULE = "#dcd8cf";

export interface ExportCaption {
  /** The collage's name, or empty when it has none. */
  title: string;
  /** What sits beside the signature, e.g. "3 pieces · made nov 2, 2026". */
  detail: string;
}

/** The fonts the caption is set in, waited for so the canvas does not fall back. */
async function captionFonts(size: number): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(
    [
      `500 ${size}px Lora`,
      `italic 500 ${size}px Lora`,
      `400 ${size}px "Martian Mono"`,
    ].map((font) => document.fonts.load(font).catch(() => [])),
  );
}

/** Draws text no wider than `room`, cutting it with an ellipsis if it must. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  room: number,
): string {
  if (context.measureText(text).width <= room) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > room) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

/** Where the paper sits on the mat, and how big the whole mat is, in pixels. */
export interface MatLayout {
  width: number;
  height: number;
  window: { x: number; y: number; width: number; height: number };
}

/** The mat for a sheet of paper this many pixels across and down. */
export function matLayout(paperWidth: number, paperHeight: number): MatLayout {
  const mat = Math.round(paperWidth * MAT_SHARE);
  const band = Math.round(paperWidth * CAPTION_SHARE);
  return {
    width: paperWidth + mat * 2,
    height: paperHeight + mat + band,
    window: { x: mat, y: mat, width: paperWidth, height: paperHeight },
  };
}

/**
 * Paints the mat and its caption onto a context the size of `layout`. The
 * paper's window is left as bare mat, for the caller to draw a face into.
 */
export async function paintMat(
  context: CanvasRenderingContext2D,
  layout: MatLayout,
  caption: ExportCaption,
): Promise<void> {
  const { window: paper } = layout;
  const mat = paper.x;
  context.fillStyle = MAT_COLOR;
  context.fillRect(0, 0, layout.width, layout.height);

  const titleSize = Math.max(12, Math.round(paper.width * 0.019));
  const smallSize = Math.max(8, Math.round(paper.width * 0.0115));
  await captionFonts(titleSize);
  const baseline = (paper.y + paper.height + layout.height) / 2;
  context.save();
  context.textBaseline = "middle";

  // The signature sits at the right end, the details just before it.
  context.textAlign = "right";
  context.fillStyle = MUTED;
  context.font = `italic 500 ${Math.round(smallSize * 1.25)}px Lora, Georgia, serif`;
  const signature = "we were online";
  const right = layout.width - mat;
  context.fillText(signature, right, baseline);
  const signatureWidth = context.measureText(signature).width;

  context.font = `400 ${smallSize}px "Martian Mono", monospace`;
  const detail = `${caption.detail}  ·  `;
  context.fillText(detail, right - signatureWidth, baseline);
  const used = signatureWidth + context.measureText(detail).width;

  if (caption.title) {
    context.textAlign = "left";
    context.fillStyle = INK;
    context.font = `500 ${titleSize}px Lora, Georgia, serif`;
    const room = paper.width - used - mat;
    if (room > titleSize * 2) {
      context.fillText(fitText(context, caption.title, room), mat, baseline);
    }
  }
  context.restore();
}

/** The same hairline the studio draws where the paper meets the mat. */
export function paintPaperEdge(
  context: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  paperWidth: number,
): void {
  context.save();
  context.strokeStyle = RULE;
  context.lineWidth = Math.max(1, paperWidth / 800);
  context.strokeRect(box.x, box.y, box.width, box.height);
  context.restore();
}

/** The longest side an exported picture may have, mat included, in pixels. */
export const EXPORT_MAX_SIDE = 2400;
/** JPEG quality for exported pictures: high enough that nothing shows. */
const EXPORT_QUALITY = 0.9;

/** The paper's size in an export, shrunk so the whole mat fits `maxSide`. */
export function exportPaperSize(
  width: number,
  height: number,
  maxSide = EXPORT_MAX_SIDE,
): { width: number; height: number } {
  const full = matLayout(width, height);
  const ratio = Math.min(1, maxSide / Math.max(full.width, full.height, 1));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * The picture set in the studio's mat: an even border on three sides and a
 * deeper band along the bottom carrying the caption. It is saved as a JPEG no
 * more than `EXPORT_MAX_SIDE` across. The paper grain is noise a PNG cannot
 * squeeze, which is what made lossless exports run to 8MB and more.
 */
export async function frameExport(
  picture: Blob,
  caption: ExportCaption,
): Promise<Blob> {
  const image = await createImageBitmap(picture);
  try {
    const paper = exportPaperSize(image.width, image.height);
    const layout = matLayout(paper.width, paper.height);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the framed picture");
    await paintMat(context, layout, caption);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const win = layout.window;
    context.drawImage(image, win.x, win.y, win.width, win.height);
    paintPaperEdge(context, win, win.width);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not encode the framed picture")),
        "image/jpeg",
        EXPORT_QUALITY,
      ),
    );
  } finally {
    image.close();
  }
}
