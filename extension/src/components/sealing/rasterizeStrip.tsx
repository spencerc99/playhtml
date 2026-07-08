// ABOUTME: Rasterizes the real letter-scroll DOM (LetterSegment + its stylesheet) into a canvas so the
// ABOUTME: sealing ceremony's rolled paper shows the exact stamped letter — sign-off, fingerprint, date imprint.

import { createRoot } from "react-dom/client";
import type { BottleNote } from "../../features/BottleManager";
import { LetterSegment } from "../bottle/LetterSegment";
// Import the compiled stylesheet directly (not via MessageBottle's re-export) to
// keep this module out of the MessageBottle → SealingCeremony → common import
// cycle. This is the exact same CSS the on-page scroll uses.
import MESSAGE_BOTTLE_CSS from "../MessageBottle.scss?inline";

// The on-page scroll strip is 560px wide (see .mbs-strip in MessageBottle.scss);
// render the offscreen strip at that width so the segment lays out identically.
const STRIP_WIDTH_PX = 560;

// Selects which letters to render into the strip: the new letter always sits at
// the bottom (last), preceded by as many whole previous letters as fit within
// maxContentHeight (working from the most recent backward). A rough per-letter
// height estimate keeps this synchronous — the real measured height is taken
// after layout and only used to size the raster.
function selectNotes(
  previous: BottleNote[],
  newNote: BottleNote,
  maxContentHeight: number,
): BottleNote[] {
  // Matches .mbs-segment min-height (480px) + a perforation; a generous
  // estimate so we err toward fewer previous letters rather than overflowing.
  const perLetterEstimate = 500;
  const budgetForPrevious = Math.max(0, maxContentHeight - perLetterEstimate);
  const maxPrevious = Math.floor(budgetForPrevious / perLetterEstimate);
  const tail = maxPrevious > 0 ? previous.slice(-maxPrevious) : [];
  return [...tail, newNote];
}

// Serializes a rendered element subtree into an SVG-wrapped foreignObject image,
// which the browser rasterizes without tainting the canvas (all CSS assets here
// are data URIs). Webfonts do not load inside the SVG image — system fallbacks
// are expected and acceptable.
function serializeToSvgImage(
  container: HTMLElement,
  width: number,
  height: number,
): string {
  // The foreignObject content must be XHTML: wrap in an explicit XHTML-namespaced
  // div and serialize with XMLSerializer so the markup is XML-valid.
  const xhtml = new XMLSerializer().serializeToString(container);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<style><![CDATA[${MESSAGE_BOTTLE_CSS}]]></style>` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Renders the real letter-scroll strip (previous letters' tail + the new letter)
 * offscreen and rasterizes it onto a canvas of `canvasWidth` × the raster's
 * scaled height. Returns null on any failure so callers can fall back to the
 * painter-based texture.
 */
export async function rasterizeStrip(
  notes: BottleNote[],
  newNote: BottleNote,
  canvasWidth: number,
  maxCanvasHeight: number,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const scale = canvasWidth / STRIP_WIDTH_PX;
  const maxContentHeight = maxCanvasHeight / scale;
  const selected = selectNotes(notes, newNote, maxContentHeight);

  // Offscreen host: fixed and far off-screen so it never flashes, sized to the
  // real strip width so the segment's internal layout matches the on-page scroll.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:" + STRIP_WIDTH_PX + "px";
  // Wrapper carries the .mbs-strip width context WITHOUT its drop-shadow filter
  // (a filter on the serialized root pollutes the raster's edges); the shadow is
  // the ceremony's own paper shading, not part of the flat texture.
  const strip = document.createElement("div");
  strip.className = "mbs-strip";
  strip.style.filter = "none";
  host.appendChild(strip);
  document.body.appendChild(host);

  const root = createRoot(strip);

  try {
    root.render(
      <>
        {selected.map((note, i) => (
          <LetterSegment key={i} note={note} />
        ))}
      </>,
    );

    // Let React commit + the browser lay out and resolve masks/border-images.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const stripHeight = strip.getBoundingClientRect().height;
    if (stripHeight <= 0) return null;

    const dataUrl = serializeToSvgImage(strip, STRIP_WIDTH_PX, Math.ceil(stripHeight));

    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
    if (!img) return null;

    const out = document.createElement("canvas");
    out.width = canvasWidth;
    out.height = Math.ceil(stripHeight * scale);
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, out.width, out.height);
    return out;
  } catch {
    return null;
  } finally {
    // Defer unmount so React isn't torn down synchronously inside its own render.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }
}
