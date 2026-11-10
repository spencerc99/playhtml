// ABOUTME: Which picture-reading model scrap search uses, and how search words are phrased for it.
// ABOUTME: Changing the model invalidates every stored vector, so the index is keyed by this id.

export const MEANING_MODEL = {
  /** SigLIP base (Google, 2023), Apache 2.0, as ONNX for transformers.js. */
  id: "Xenova/siglip-base-patch16-224",
  revision: "main",
  dtype: "q8",
  /** Roughly what the first download costs, for the button that starts it. */
  approximateMegabytes: 210,
} as const;

/** Names the stored vectors, so a different model never compares against them. */
export const MEANING_INDEX_VERSION = `${MEANING_MODEL.id}@${MEANING_MODEL.revision}:${MEANING_MODEL.dtype}`;

/** The model was trained on captions, so a bare word reads better inside one. */
export const MEANING_PROMPT = (words: string) => `a photo of ${words.trim()}`;

/**
 * How close a picture has to be to the search words to count as a match.
 * Measured on 49 real scraps and 26 hand-labelled searches: at 0.03, 67 of 73
 * right pictures matched, the matches that were wrong mostly ranked below the
 * right ones, and a search for something absent ("mask") matched nothing.
 * In the browser "eye" put the googly eyes at 0.038 and everything else
 * below 0.02.
 */
export const MEANING_MATCH_THRESHOLD = 0.03;
