// ABOUTME: Builds a complete collage record from the current studio draft for file export.
// ABOUTME: Keeps the opened record when untouched and carries the latest available preview.

import type { SaveStanding } from "./autosaveSchedule";
import type { CollageRecord } from "./collageRecord";
import type { CollageDraft } from "./useCollageAutosave";

export function collageFromDraft(options: {
  draft: CollageDraft;
  standing: SaveStanding;
  opened: CollageRecord | null;
  preview: Blob | null;
}): CollageRecord | null {
  const { draft, standing, opened, preview } = options;
  if (opened && standing.kind === "untouched") return opened;
  if (!draft.hasContent && !opened) return null;
  return {
    ...draft.record,
    preview: preview
      ? { drawn: true, image: preview }
      : (opened?.preview ?? { drawn: false, reason: "not drawn yet" }),
  } as CollageRecord;
}
