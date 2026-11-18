// ABOUTME: Decides what the collages board shows once every pinned collage has been asked for.
// ABOUTME: Separates "nothing is pinned" from "nothing could be loaded" so a down server isn't shown as empty.

/** One pinned collage's outcome: its entry, gone (unshared), or failed to load. */
export type PinnedLoad<T> = T | "missing" | "failed";

/**
 * The entries that loaded, or "failed" when none did and at least one request
 * failed. A board with some collages still shows them; one with no collages
 * because they were all unshared is genuinely empty.
 */
export function boardContents<T>(
  loads: readonly PinnedLoad<T>[],
): T[] | "failed" {
  const found = loads.filter(
    (load): load is T => load !== "missing" && load !== "failed",
  );
  if (found.length === 0 && loads.includes("failed")) return "failed";
  return found;
}
