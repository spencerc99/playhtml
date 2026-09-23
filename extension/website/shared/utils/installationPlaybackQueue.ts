// ABOUTME: Admits fresh live recordings before a continuously rotating archive.
// ABOUTME: Excludes visible recordings, tracks growth, and preserves waiting work across pool updates.
export interface InstallationRecording<T> {
  id: string;
  live: boolean;
  value: T;
  /**
   * Marks how much footage this recording holds. A live recording is still
   * being written while it plays, so a changed version means new footage the
   * viewer has not seen — both for players extending it on screen and for the
   * queue, which offers it again as live material. Omit for fixed recordings.
   */
  version?: string | number;
}

export class InstallationPlaybackQueue<T> {
  private recordings = new Map<string, InstallationRecording<T>>();
  private seen = new Set<string>();
  /** id -> version that was playing when it was last taken as live footage. */
  private playedLive = new Map<string, string | number | undefined>();

  update(recordings: readonly InstallationRecording<T>[]) {
    const incoming = new Map(
      recordings.map((recording) => [recording.id, recording]),
    );
    for (const id of this.recordings.keys()) {
      if (!incoming.has(id)) {
        this.recordings.delete(id);
        this.seen.delete(id);
        this.playedLive.delete(id);
      }
    }
    for (const [id, recording] of incoming) {
      const previous = this.recordings.get(id);
      // Grown footage is unseen footage: let it come round again.
      if (previous && previous.version !== recording.version) {
        this.seen.delete(id);
      }
      this.recordings.set(id, recording);
    }
  }

  /** The newest version of a recording, for a player still showing an older one. */
  current(id: string): InstallationRecording<T> | null {
    return this.recordings.get(id) ?? null;
  }

  take(activeIds: ReadonlySet<string>): T | null {
    const available = [...this.recordings.values()].filter(
      (recording) => !activeIds.has(recording.id),
    );
    let next =
      available.find(
        (recording) =>
          recording.live &&
          (!this.playedLive.has(recording.id) ||
            this.playedLive.get(recording.id) !== recording.version),
      ) ?? available.find((recording) => !this.seen.has(recording.id));
    if (!next && available.length > 0) {
      this.seen.clear();
      for (const id of activeIds) this.seen.add(id);
      next = available[0];
    }
    if (!next) return null;
    this.seen.add(next.id);
    if (next.live) this.playedLive.set(next.id, next.version);
    return next.value;
  }
}

export const INSTALLATION_ARRIVAL_MS = 1500;
export const INSTALLATION_TYPING_ARRIVAL_MS = 750;
export const INSTALLATION_FADE_MS = 2000;
export const INSTALLATION_SCROLL_HOLD_MS = 4000;
export const INSTALLATION_TYPING_HOLD_MS = 8000;
