// ABOUTME: Canonical identity for internet scraps, shared between render-time collage
// ABOUTME: dedup and extension storage-time dedup so near-duplicates never persist.

/**
 * Canonical identity for near-duplicate detection: two scraps with the same
 * canonical key are treated as the same underlying thing even though their
 * raw capture differs (different computed style values, different rendered
 * size, different CDN query params).
 */

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

const PATH_DATA_PATTERN = /\bd="([^"]*)"/g;
const VIEW_BOX_PATTERN = /\bviewBox="([^"]*)"/;
const SIZE_AND_PAINT_ATTRIBUTE_PATTERN =
  /\b(?:width|height|fill|stroke|style)="[^"]*"/g;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function svgGeometryHash(markup: string): string {
  const pathData: string[] = [];
  for (const match of markup.matchAll(PATH_DATA_PATTERN)) {
    pathData.push(match[1]);
  }
  const viewBox = markup.match(VIEW_BOX_PATTERN)?.[1] ?? "";

  if (pathData.length > 0) {
    return String(
      hashString(normalizeWhitespace(pathData.join("|") + "|" + viewBox)),
    );
  }

  const shapeMarkup = markup.replace(SIZE_AND_PAINT_ATTRIBUTE_PATTERN, "");
  return String(hashString(normalizeWhitespace(shapeMarkup)));
}

export function canonicalImageKey(src: string): string {
  try {
    const url = new URL(src);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return src;
  }
}

export function canonicalButtonKey(
  domain: string,
  text: string,
  backgroundColor: string | undefined,
): string {
  const normalizedText = normalizeWhitespace(text.toLowerCase());
  return `${domain}|button|${normalizedText}|${backgroundColor ?? ""}`;
}

export function canonicalSvgIconKey(domain: string, markup: string): string {
  return `${domain}|svg|${svgGeometryHash(markup)}`;
}

export function canonicalCursorKey(url: string): string {
  return url;
}
