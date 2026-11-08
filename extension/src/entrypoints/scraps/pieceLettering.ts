// ABOUTME: The size a scrap arrives at, and how a lettered piece scales its words.
// ABOUTME: Shared by the studio, the crop session and the bake so all three agree.

import {
  headingDisplayFontSize,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  MIN_PIECE_SIDE,
  boxCenter,
  rotatePoint,
  type BoxEdge,
  type PieceBox,
  type Point,
} from "./collageGeometry";

/** Average character width as a fraction of font size, for sizing a heading. */
const HEADING_CHARACTER_ADVANCE = 0.68;

/** Natural size of a scrap, so a placed piece keeps its own proportions. */
export function naturalScrapSize(item: ScrapItem): {
  width: number;
  height: number;
} {
  switch (item.kind) {
    case "image":
      return { width: item.naturalWidth, height: item.naturalHeight };
    case "svg-icon":
      return { width: item.width, height: item.height };
    case "button":
      return { width: Math.max(80, item.text.length * 11 + 40), height: 40 };
    case "heading": {
      // Sized from the same font size the shared renderer draws the heading
      // at, so a placed heading arrives at the proportions it will keep.
      const fontSize = headingDisplayFontSize(item.styles, item.text);
      const width = Math.max(
        90,
        item.text.trim().length * fontSize * HEADING_CHARACTER_ADVANCE + 16,
      );
      return { width, height: Math.max(28, fontSize * 1.15 + 12) };
    }
    case "cursor":
      return { width: 32, height: 32 };
  }
}

/**
 * How a piece made of words fills its box. The words are set in a box of
 * `width` by `height` at the scrap's own type size, then scaled by `scale` to
 * the piece's box, so resizing the piece resizes the lettering with it. The
 * scale is the smaller of the two stretches, so a piece pulled out of its
 * proportions keeps its letters unstretched and rewraps them instead.
 */
export interface LetteringLayout {
  width: number;
  height: number;
  scale: number;
}

type LetteredScrap = Extract<ScrapItem, { kind: "heading" | "button" }>;

/** Whether a scrap is made of words, which scale with the piece they are on. */
export function isLettered(scrap: ScrapItem): scrap is LetteredScrap {
  return scrap.kind === "heading" || scrap.kind === "button";
}

/**
 * Sets a lettered scrap in a piece's box. Without `letteringWidth` the words
 * keep the line breaks they arrived with and scale to the box. With it, the
 * words wrap to that width (in the scrap's own type size) and scale to the
 * box's width, so a heading pulled narrower from its side wraps onto more
 * lines instead of shrinking.
 */
export function letteringLayout(
  scrap: LetteredScrap,
  box: { width: number; height: number },
  letteringWidth?: number,
): LetteringLayout {
  if (box.width <= 0 || box.height <= 0) {
    throw new Error("letteringLayout received a box with no area");
  }
  if (letteringWidth !== undefined && letteringWidth > 0) {
    const scale = box.width / letteringWidth;
    return { width: letteringWidth, height: box.height / scale, scale };
  }
  const natural = naturalScrapSize(scrap);
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: box.width / scale, height: box.height / scale, scale };
}

/** The line height a heading is set at, matching the shared renderer. */
export const HEADING_LINE_HEIGHT = 1.15;
/** The heading's own side padding, as the shared renderer and bake set it. */
const HEADING_SIDE_PADDING = 4;
/** Room above and below a heading's lines, as its natural size leaves. */
const HEADING_VERTICAL_ROOM = 12;

type HeadingScrap = Extract<ScrapItem, { kind: "heading" }>;

/**
 * How tall a heading's words stand once wrapped to `letteringWidth`, in the
 * scrap's own type size. Measured in the live document so the studio, the
 * bake and the viewer break lines where the real typeface does; falls back to
 * an estimate where nothing is laid out.
 */
export function headingHeightAtLetteringWidth(
  scrap: HeadingScrap,
  letteringWidth: number,
): number {
  const fontSize = headingDisplayFontSize(scrap.styles, scrap.text);
  const measured = measureHeadingLines(scrap, letteringWidth, fontSize);
  const lines =
    measured ??
    Math.max(1, fontSize * HEADING_LINE_HEIGHT) *
      Math.max(
        1,
        Math.ceil(
          (scrap.text.trim().length * fontSize * HEADING_CHARACTER_ADVANCE) /
            Math.max(1, letteringWidth - HEADING_SIDE_PADDING * 2),
        ),
      );
  return Math.max(28, lines + HEADING_VERTICAL_ROOM);
}

function measureHeadingLines(
  scrap: HeadingScrap,
  letteringWidth: number,
  fontSize: number,
): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const probe = document.createElement("span");
  Object.assign(probe.style, scrap.styles);
  Object.assign(probe.style, {
    position: "absolute",
    left: "-100000px",
    top: "0",
    visibility: "hidden",
    display: "block",
    boxSizing: "border-box",
    width: `${letteringWidth}px`,
    padding: `0 ${HEADING_SIDE_PADDING}px`,
    margin: "0",
    fontSize: `${fontSize}px`,
    lineHeight: String(HEADING_LINE_HEIGHT),
    textAlign: "center",
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  });
  probe.textContent = scrap.text;
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height > 0 ? height : null;
}

/**
 * Pulls a heading piece wider or narrower from one of its sides. Its type
 * keeps its size and its words rewrap to the new width; the piece then grows
 * or shrinks downward to hold the lines, keeping its top edge where it was
 * (or about its middle with `aboutCenter`). Works in the piece's own turned
 * axes, so a rotated heading rewraps along its own baseline.
 */
export function rewrapHeadingFromSide(options: {
  box: PieceBox & { rotation: number; flipY: boolean };
  scrap: HeadingScrap;
  letteringWidth: number | undefined;
  edge: Extract<BoxEdge, "left" | "right">;
  pointer: Point;
  aboutCenter: boolean;
  measure?: (scrap: HeadingScrap, letteringWidth: number) => number;
}): PieceBox & { letteringWidth: number } {
  const { box, scrap, edge, pointer, aboutCenter } = options;
  const measure = options.measure ?? headingHeightAtLetteringWidth;
  const { scale } = letteringLayout(scrap, box, options.letteringWidth);
  const radians = (box.rotation * Math.PI) / 180;
  const center = boxCenter(box);
  const local = rotatePoint(pointer, center, -radians);
  const right = box.x + box.width;

  const fontSize = headingDisplayFontSize(scrap.styles, scrap.text);
  const narrowest = Math.max(
    MIN_PIECE_SIDE,
    (fontSize * 1.5 + HEADING_SIDE_PADDING * 2) * scale,
  );
  const pulled = aboutCenter
    ? 2 * Math.abs(local.x - center.x)
    : edge === "right"
      ? local.x - box.x
      : right - local.x;
  const width = Math.max(narrowest, pulled);
  const letteringWidth = width / scale;
  const height = Math.max(MIN_PIECE_SIDE, measure(scrap, letteringWidth) * scale);

  const left = aboutCenter
    ? center.x - width / 2
    : edge === "right"
      ? box.x
      : right - width;
  // The edge the words start from stays put: the top, or the bottom when the
  // piece is mirrored upside down.
  const top = aboutCenter
    ? center.y - height / 2
    : box.flipY
      ? box.y + box.height - height
      : box.y;
  const newCenter = rotatePoint(
    { x: left + width / 2, y: top + height / 2 },
    center,
    radians,
  );
  return {
    x: newCenter.x - width / 2,
    y: newCenter.y - height / 2,
    width,
    height,
    letteringWidth,
  };
}

/**
 * Pulls a heading piece taller or shorter from its top or bottom. Its type
 * keeps its size and its lines stay as they are; the box gains or loses room
 * around them, but never gets shorter than the lines it holds. The opposite
 * edge stays put, or the middle does with `aboutCenter`.
 */
export function resizeHeadingFromEnd(options: {
  box: PieceBox & { rotation: number };
  scrap: HeadingScrap;
  letteringWidth: number | undefined;
  edge: Extract<BoxEdge, "top" | "bottom">;
  pointer: Point;
  aboutCenter: boolean;
  measure?: (scrap: HeadingScrap, letteringWidth: number) => number;
}): PieceBox & { letteringWidth: number } {
  const { box, scrap, edge, pointer, aboutCenter } = options;
  const measure = options.measure ?? headingHeightAtLetteringWidth;
  const layout = letteringLayout(scrap, box, options.letteringWidth);
  const radians = (box.rotation * Math.PI) / 180;
  const center = boxCenter(box);
  const local = rotatePoint(pointer, center, -radians);
  const bottom = box.y + box.height;

  const shortest = Math.max(
    MIN_PIECE_SIDE,
    measure(scrap, layout.width) * layout.scale,
  );
  const pulled = aboutCenter
    ? 2 * Math.abs(local.y - center.y)
    : edge === "bottom"
      ? local.y - box.y
      : bottom - local.y;
  const height = Math.max(shortest, pulled);
  const top = aboutCenter
    ? center.y - height / 2
    : edge === "bottom"
      ? box.y
      : bottom - height;
  const newCenter = rotatePoint(
    { x: box.x + box.width / 2, y: top + height / 2 },
    center,
    radians,
  );
  return {
    x: newCenter.x - box.width / 2,
    y: newCenter.y - height / 2,
    width: box.width,
    height,
    letteringWidth: layout.width,
  };
}
