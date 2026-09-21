// ABOUTME: The fixed sizes a collage can be made at, and the paper it sits on.
// ABOUTME: A collage has one true size; the studio only ever zooms it to fit.

export type CollageFormatName =
  | "postcard"
  | "postcard-tall"
  | "square"
  | "wide";

export interface CollageFormat {
  name: CollageFormatName;
  label: string;
  width: number;
  height: number;
}

export const COLLAGE_FORMATS: Record<CollageFormatName, CollageFormat> = {
  postcard: {
    name: "postcard",
    label: "postcard",
    width: 1500,
    height: 1000,
  },
  "postcard-tall": {
    name: "postcard-tall",
    label: "postcard tall",
    width: 1000,
    height: 1500,
  },
  square: { name: "square", label: "square", width: 1200, height: 1200 },
  wide: { name: "wide", label: "wide", width: 1600, height: 900 },
};

export const DEFAULT_FORMAT: CollageFormatName = "postcard";

export const FORMAT_NAMES = Object.keys(
  COLLAGE_FORMATS,
) as CollageFormatName[];

export function isCollageFormatName(
  value: unknown,
): value is CollageFormatName {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(COLLAGE_FORMATS, value)
  );
}

export function formatOf(name: CollageFormatName): CollageFormat {
  return COLLAGE_FORMATS[name];
}

/**
 * The paper a collage is made on. Only a flat color today; a later paper could
 * carry a texture or a color lifted from a collected page, which is why this
 * is a named thing on the record rather than a bare background string.
 */
export interface CollagePaper {
  color: string;
}

export const PAPER_TONES: { label: string; color: string }[] = [
  { label: "scrap paper", color: "#fffdf9" },
  { label: "warm linen", color: "#faf7f2" },
  { label: "aged paper", color: "#f5f0e8" },
  { label: "kraft", color: "#c9a678" },
  { label: "soft black", color: "#2b2724" },
  { label: "white", color: "#ffffff" },
];

export const DEFAULT_PAPER: CollagePaper = { color: PAPER_TONES[0].color };

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isPaperColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value.trim());
}

export function parsePaper(value: unknown): CollagePaper {
  if (!value || typeof value !== "object") {
    throw new Error("Collage record is missing its paper");
  }
  const paper = value as Record<string, unknown>;
  if (!isPaperColor(paper.color)) {
    throw new Error(
      `Collage paper color is not a hex color: ${String(paper.color)}`,
    );
  }
  return { color: paper.color.trim().toLowerCase() };
}
