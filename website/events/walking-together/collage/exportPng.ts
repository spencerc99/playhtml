// ABOUTME: Draws the table collage into a PNG for the admin's export.
// ABOUTME: Images without CORS access are drawn as torn-paper placeholders instead.

import { sortedPieces, sourceDomain, type Pieces, type Piece } from "./pieces";

const PAPER = "#f4efe6";
const PLACEHOLDER = "#e9e1d2";
const INK = "#6f665c";

/** Loads an image for drawing into a canvas. Pieces on the table load without
 * CORS so any image shows; the export needs CORS so the canvas stays readable,
 * so a host that refuses it falls back to a placeholder here. */
function loadForCanvas(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** A jagged rectangle, like a scrap torn out of a page. Deterministic per
 * piece so repeated exports match. */
function tornRectPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
) {
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const step = Math.max(6, Math.min(w, h) / 10);
  const jag = Math.max(2, step / 3);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  for (let x = -w / 2; x < w / 2; x += step) ctx.lineTo(x, -h / 2 + rand() * jag);
  for (let y = -h / 2; y < h / 2; y += step) ctx.lineTo(w / 2 - rand() * jag, y);
  for (let x = w / 2; x > -w / 2; x -= step) ctx.lineTo(x, h / 2 - rand() * jag);
  for (let y = h / 2; y > -h / 2; y -= step) ctx.lineTo(-w / 2 + rand() * jag, y);
  ctx.closePath();
}

function seedOf(piece: Piece): number {
  let hash = 0;
  for (const ch of piece.id) hash = (hash * 31 + ch.charCodeAt(0)) % 233280;
  return hash;
}

/** Renders every piece, in paint order, onto a paper-toned canvas sized like
 * the table on screen. */
export async function renderCollagePng(
  pieces: Pieces,
  size: { width: number; height: number },
  pixelRatio = 2,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * pixelRatio);
  canvas.height = Math.round(size.height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable for export.");
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size.width, size.height);

  const ordered = sortedPieces(pieces);
  const images = await Promise.all(ordered.map((p) => loadForCanvas(p.src)));

  ordered.forEach((piece, i) => {
    const img = images[i];
    const w = piece.width * size.width;
    const h = w * piece.aspect;
    ctx.save();
    ctx.translate(piece.x * size.width, piece.y * size.height);
    ctx.rotate((piece.rotation * Math.PI) / 180);
    ctx.shadowColor = "rgba(61, 56, 51, 0.22)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    if (img) {
      // The crop picks the part of the source the piece shows; the flip
      // mirrors it inside the piece's box. Cutouts export uncut.
      const crop = piece.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      ctx.scale(piece.flipX ? -1 : 1, piece.flipY ? -1 : 1);
      ctx.drawImage(
        img,
        crop.x * img.naturalWidth,
        crop.y * img.naturalHeight,
        crop.width * img.naturalWidth,
        crop.height * img.naturalHeight,
        -w / 2,
        -h / 2,
        w,
        h,
      );
    } else {
      tornRectPath(ctx, w, h, seedOf(piece));
      ctx.fillStyle = PLACEHOLDER;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = INK;
      ctx.font = `${Math.max(10, Math.min(16, w / 10))}px Cousine, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sourceDomain(piece) || "scrap", 0, 0, w * 0.9);
    }
    ctx.restore();
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The collage canvas could not be encoded as PNG."));
    }, "image/png");
  });
}

/** Hands the PNG to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
