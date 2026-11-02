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

/**
 * The picture set in the studio's mat: an even border on three sides and a
 * deeper band along the bottom carrying the caption, sized to the picture so a
 * 2x export gets a 2x mat.
 */
export async function frameExport(
  picture: Blob,
  caption: ExportCaption,
): Promise<Blob> {
  const image = await createImageBitmap(picture);
  try {
    const mat = Math.round(image.width * MAT_SHARE);
    const band = Math.round(image.width * CAPTION_SHARE);
    const canvas = document.createElement("canvas");
    canvas.width = image.width + mat * 2;
    canvas.height = image.height + mat + band;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the framed picture");

    context.fillStyle = MAT_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, mat, mat);
    // The same hairline the studio draws where the paper meets the mat.
    context.strokeStyle = RULE;
    context.lineWidth = Math.max(1, image.width / 800);
    context.strokeRect(mat, mat, image.width, image.height);

    const titleSize = Math.max(12, Math.round(image.width * 0.019));
    const smallSize = Math.max(8, Math.round(image.width * 0.0115));
    await captionFonts(titleSize);
    const baseline = image.height + mat + band / 2;
    context.textBaseline = "middle";

    // The signature sits at the right end, the details just before it.
    context.textAlign = "right";
    context.fillStyle = MUTED;
    context.font = `italic 500 ${Math.round(smallSize * 1.25)}px Lora, Georgia, serif`;
    const signature = "we were online";
    const right = canvas.width - mat;
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
      const room = image.width - used - mat;
      if (room > titleSize * 2) {
        context.fillText(fitText(context, caption.title, room), mat, baseline);
      }
    }

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not encode the framed picture")),
        "image/png",
      ),
    );
  } finally {
    image.close();
  }
}
