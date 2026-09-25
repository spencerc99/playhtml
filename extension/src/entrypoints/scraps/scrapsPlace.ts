// ABOUTME: Where the scraps page is, written into the URL hash so a reload lands back there.
// ABOUTME: Browse, the collage list, a new collage, or one saved collage by id.

export type ScrapsPlace =
  | { mode: "browse" }
  | { mode: "create"; collage: null }
  | { mode: "create"; collage: "new" }
  | { mode: "create"; collage: { id: string } };

const CREATE = "create";
const NEW = "new";

/** The hash for a place, with its leading "#", or "" for browse. */
export function placeHash(place: ScrapsPlace): string {
  if (place.mode === "browse") return "";
  if (place.collage === null) return `#${CREATE}`;
  if (place.collage === NEW) return `#${CREATE}/${NEW}`;
  return `#${CREATE}/${encodeURIComponent(place.collage.id)}`;
}

/** Reads a hash back into a place. Anything unrecognised is browse. */
export function parsePlaceHash(hash: string): ScrapsPlace {
  const [head, rest] = hash.replace(/^#/, "").split(/\/(.*)/s, 2);
  if (head !== CREATE) return { mode: "browse" };
  if (!rest) return { mode: "create", collage: null };
  if (rest === NEW) return { mode: "create", collage: NEW };
  return { mode: "create", collage: { id: decodeURIComponent(rest) } };
}
