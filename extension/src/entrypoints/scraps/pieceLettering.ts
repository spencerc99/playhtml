// ABOUTME: The size a scrap arrives at, and how a lettered piece scales its words.
// ABOUTME: Shared by the studio, the crop session and the bake so all three agree.

import {
  headingDisplayFontSize,
  type ScrapItem,
} from "@movement/components/ScrapCollage";

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

export function letteringLayout(
  scrap: LetteredScrap,
  box: { width: number; height: number },
): LetteringLayout {
  if (box.width <= 0 || box.height <= 0) {
    throw new Error("letteringLayout received a box with no area");
  }
  const natural = naturalScrapSize(scrap);
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: box.width / scale, height: box.height / scale, scale };
}
