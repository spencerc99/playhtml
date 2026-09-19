// ABOUTME: Validates the manual labels used as commute evaluation ground truth.
// ABOUTME: Rejects malformed imported corrections before they reach browser storage or rendering.

import { CHARACTER_LABELS, CONTENT_CATEGORIES, EXPOSURE_LABELS, PAGE_TYPES, PROMOTION_JUDGMENTS } from "./evaluationTypes";

export interface Correction {
  category?: typeof CONTENT_CATEGORIES[number];
  pageType?: typeof PAGE_TYPES[number];
  exposure?: typeof EXPOSURE_LABELS[number];
  character?: typeof CHARACTER_LABELS[number];
  judgment?: typeof PROMOTION_JUDGMENTS[number];
  updatedAt: string;
}
export type Corrections = Record<string, Correction>;

export function parseCorrections(value: unknown, candidateIds: Set<string>): Corrections {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Correction file is missing corrections");
  const result: Corrections = {};
  const labels = { category: CONTENT_CATEGORIES, pageType: PAGE_TYPES, exposure: EXPOSURE_LABELS, character: CHARACTER_LABELS, judgment: PROMOTION_JUDGMENTS };
  for (const [id, row] of Object.entries(value)) {
    if (!candidateIds.has(id)) continue;
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error("Correction has an invalid timestamp or label record");
    const correction: Correction = { updatedAt: row.updatedAt };
    for (const [key, options] of Object.entries(labels)) {
      if (row[key] === undefined) continue;
      if (!(options as readonly unknown[]).includes(row[key])) throw new Error(`Correction has an invalid ${key} label`);
      Object.assign(correction, { [key]: row[key] });
    }
    result[id] = correction;
  }
  return result;
}
