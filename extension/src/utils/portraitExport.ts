// ABOUTME: Shared utilities for exporting page and domain portrait images
// ABOUTME: Handles compositing page screenshots with trails SVG, and html2canvas capture

/**
 * Render an SVG element to ImageBitmap at given dimensions.
 * @param viewBoxOverride - If provided, sets the SVG viewBox to this value instead of
 *   the default `0 0 width height`. Used for scroll-animated export where the viewBox
 *   pans across document space (e.g. `${scrollX} ${scrollY} ${width} ${height}`).
 */
export async function svgToImageBitmap(
  svgEl: SVGSVGElement,
  width: number,
  height: number,
  viewBoxOverride?: string,
): Promise<ImageBitmap> {
  // Clone SVG and set explicit dimensions so it renders correctly as a standalone image
  // (percentage width/height are unresolvable outside the DOM)
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  // Always override viewBox — the live SVG viewBox reflects the rendered container, not
  // the export target. Use the caller-supplied viewBox for scroll-panning, or default
  // to full canvas dimensions for static export.
  clone.setAttribute("viewBox", viewBoxOverride ?? `0 0 ${width} ${height}`);

  const serialized = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialized], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Composite page PNG data URL + trails SVG element → download as PNG.
 */
export async function compositePagePortrait(
  pagePngDataUrl: string,
  trailsSvgEl: SVGSVGElement,
  filename: string,
): Promise<void> {
  const canvas = new OffscreenCanvas(window.innerWidth, window.innerHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  // Draw page screenshot
  const pageImg = new Image();
  await new Promise<void>((resolve, reject) => {
    pageImg.onload = () => resolve();
    pageImg.onerror = reject;
    pageImg.src = pagePngDataUrl;
  });
  ctx.drawImage(pageImg, 0, 0, canvas.width, canvas.height);

  // Draw trails on top
  const trailsBitmap = await svgToImageBitmap(
    trailsSvgEl,
    canvas.width,
    canvas.height,
  );
  ctx.drawImage(trailsBitmap, 0, 0);
  trailsBitmap.close();

  // Download
  const blob = await canvas.convertToBlob({ type: "image/png" });
  triggerDownload(blob, filename);
}

/**
 * Capture a DOM element via html2canvas → download as PNG.
 * Imports html2canvas lazily to avoid bloating content script bundle.
 */
export async function captureDomPortrait(
  el: HTMLElement,
  filename: string,
): Promise<void> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    scale: 1,
  });
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, filename);
  }, "image/png");
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Filename for page portrait exports.
 */
export function pagePortraitFilename(domain: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `we-were-online-${domain}-${date}.png`;
}

/**
 * Filename for domain portrait exports.
 */
export function domainPortraitFilename(domain: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `we-were-online-${domain}-portrait-${date}.png`;
}
