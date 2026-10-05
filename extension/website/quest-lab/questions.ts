// ABOUTME: The questions Clef answers about each scrap image, and the typed answers that come back.
// ABOUTME: One request per scrap asks base-shape and layout questions together over the same state.

import type { ScrapItem } from "@movement/components/ScrapCollage";

export type ImageScrap = Extract<ScrapItem, { kind: "image" }>;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

/**
 * The part each scrap plays in a collage. Clef only sorts; the layout code
 * decides sizes, spots, and angles. Every scrap plays some part: a weak image
 * simply never becomes a hero.
 */
export const ROLES = {
  hero: "A visually striking, clear single subject that would look great large and cut out, the kind of thing your eye lands on first",
  supporting: "A solid image that fills in the collage around the standouts without needing attention of its own",
  accent: "A small, simple, graphic thing (a logo, icon, sticker, button, or little object) that works as a small mark, even repeated",
  background: "A wide, textured, or patterned image (foliage, sky, fabric, a crowd, a landscape, a page of text) that works as wallpaper behind everything else",
} as const;
export type Role = keyof typeof ROLES;

export const IMAGE_KINDS = {
  "object-photo": "A photo of one physical object or product",
  illustration: "A drawing, painting, or illustration",
  "logo-or-icon": "A logo, icon, emoji, or small UI glyph",
  scene: "A photo of a scene, place, or several people or things",
  screenshot: "A screenshot or interface capture",
  "text-graphic": "Mostly text: a banner, headline graphic, or chart",
} as const;
export type ImageKind = keyof typeof IMAGE_KINDS;

export interface ScrapAnswers {
  silhouette: ScoreAnswer;
  isolated: NoulAnswer;
  kind: ChoiceAnswer;
  questFit: ScoreAnswer;
  role: ChoiceAnswer;
  cutout: NoulAnswer;
}

/** The quest itself is the context: what was browsed, not a summary of it. */
export interface QuestContext {
  sites: string[];
  pageTitles: string[];
}

/** What Clef sees as text next to the image. */
export function scrapState(scrap: ImageScrap, quest: QuestContext) {
  return {
    scrap: {
      alt: scrap.alt ?? "",
      pageTitle: scrap.pageTitle,
      site: scrap.domain,
      widthToHeight: Number((scrap.naturalWidth / scrap.naturalHeight).toFixed(2)),
    },
    quest,
  };
}

export function scrapQuestions() {
  return {
    silhouette: {
      type: "score",
      instructions:
        "Imagine the main subject of the image cut out and filled solid black. How recognizable is that silhouette as a specific thing, the way a teapot or a bicycle outline is?",
      criteria: [
        "No single subject: a texture, a scene, text, or a screenshot",
        "A blob or rectangle that reads as nothing in particular",
        "A rough category is guessable, such as some kind of furniture",
        "A clearly recognizable object, such as a chair, a phone, or a shoe",
        "An iconic outline anyone would name instantly",
      ],
    },
    isolated: {
      type: "noul",
      instructions:
        "Is the image one subject on a plain or uniform background, so its backdrop could be removed cleanly by flooding in from the edges?",
      criteria: {
        true: "One subject on a plain, flat, or near-white background",
        false: "A busy background, a full-bleed photo, or several subjects",
      },
    },
    kind: {
      type: "choice",
      instructions: "What kind of image is this?",
      criteria: IMAGE_KINDS,
    },
    questFit: {
      type: "score",
      instructions:
        "These images were collected during one stretch of browsing, whose sites and page titles are in `quest`. How well does this image stand for what that browsing was about?",
      criteria: [
        "Unrelated to the rest of the browsing",
        "Loosely related, such as the same broad topic",
        "Clearly part of what was being browsed",
        "The very thing the browsing was about",
      ],
    },
    role: {
      type: "choice",
      instructions: "In a scrapbook collage made from these browsing scraps, what part should this image play?",
      criteria: ROLES,
    },
    cutout: {
      type: "noul",
      instructions:
        "Would this piece look better with its background removed, as a cut-out object, than as a rectangular photo?",
      criteria: {
        true: "Cut it out: the subject reads on its own and the backdrop adds nothing",
        false: "Keep the rectangle: the backdrop, framing, or edges are part of it",
      },
    },
  };
}

/**
 * A stand-in for Clef with no judgment at all: every score, yes/no, and
 * role is a coin flip. Laying out the same scraps from these answers shows
 * what the layout code does on its own, which is the baseline Clef must beat.
 */
export function randomAnswers(random: () => number): ScrapAnswers {
  const score = (levels: number): ScoreAnswer => {
    const probabilities = Object.fromEntries(
      Array.from({ length: levels }, (_, level) => [String(level), 1 / levels]),
    );
    return { type: "score", score: random() * (levels - 1), confidence: 0, probabilities };
  };
  const uniform = (labels: readonly string[]): ChoiceAnswer => {
    const weights = labels.map(() => random());
    const sum = weights.reduce((a, b) => a + b, 0);
    const probabilities = Object.fromEntries(labels.map((label, i) => [label, weights[i] / sum]));
    const choice = labels[weights.indexOf(Math.max(...weights))];
    return { type: "choice", choice, confidence: 0, probabilities };
  };
  return {
    silhouette: score(5),
    isolated: { type: "noul", noul: random() },
    kind: uniform(Object.keys(IMAGE_KINDS)),
    questFit: score(4),
    role: uniform(Object.keys(ROLES)),
    cutout: { type: "noul", noul: random() },
  };
}

/** Labels for a contest among up to 4 images, in the order the images are sent. */
export const CONTEST_LABELS = ["first", "second", "third", "fourth"] as const;

/** Asks Clef which of the images sent with it would make the best centerpiece. */
export function heroContestQuestion(count: number) {
  return {
    hero: {
      type: "choice",
      instructions:
        "These images were all collected during one stretch of browsing. Which single image would make the strongest centerpiece of a scrapbook collage: the most visually striking, and readable at a glance even when large and cut out?",
      criteria: Object.fromEntries(
        CONTEST_LABELS.slice(0, count).map((label) => [label, `The ${label} image`]),
      ),
    },
  };
}
