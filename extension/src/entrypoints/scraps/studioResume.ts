// ABOUTME: Works out what a collage studio reopens on: the latest stored copy, never the one it first opened with.
// ABOUTME: Waits for every studio that closed to finish storing, so the copy read is the newest one.

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

/**
 * Keeps track of every studio still storing after it closed. Each close is
 * added to the wait rather than replacing it, so a studio that closes with
 * nothing to store cannot hide an earlier one that is still baking.
 */
export interface ClosingStudios {
  /** Adds a closed studio's promise, which settles once it has stored everything. */
  note: (stored: Promise<void>) => void;
  /** Settles once every studio noted so far has finished. */
  settled: () => Promise<void>;
  /** Whether any noted studio is still storing. */
  pending: () => boolean;
}

export function closingStudios(): ClosingStudios {
  let all: Promise<void> = Promise.resolve();
  let open = 0;
  return {
    note: (stored) => {
      open += 1;
      const done = stored.then(
        () => {},
        () => {},
      );
      void done.then(() => {
        open -= 1;
      });
      all = Promise.all([all, done]).then(() => {});
    },
    settled: () => all,
    pending: () => open > 0,
  };
}
