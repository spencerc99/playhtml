// ABOUTME: Works out what a collage studio reopens on: the latest stored copy, never the one it first opened with.
// ABOUTME: Waits for the studio that just closed to finish storing, so the copy read is the newest one.

import type { CollageRecord } from "./collageRecord";

export type StudioResume =
  /** Nothing was ever stored, so the studio starts a new collage. */
  | { kind: "new" }
  | { kind: "stored"; record: CollageRecord }
  /** The collage could not be read back, so no copy of it is opened. */
  | { kind: "failed"; reason: string };

export interface StudioResumeOptions {
  /** Settles once the studio that closed has stored everything it had. */
  closing: Promise<void>;
  /**
   * The collage's id, read after `closing` settles, since a new collage's
   * first save may only land while the studio is closing. Null when nothing
   * was ever stored.
   */
  collageId: () => string | null;
  load: (id: string) => Promise<CollageRecord | null>;
}

export async function resumeStudio(
  options: StudioResumeOptions,
): Promise<StudioResume> {
  await options.closing;
  const id = options.collageId();
  if (id === null) return { kind: "new" };
  try {
    const record = await options.load(id);
    if (!record) return { kind: "failed", reason: "it is no longer saved" };
    return { kind: "stored", record };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
