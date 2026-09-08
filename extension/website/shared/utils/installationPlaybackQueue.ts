// ABOUTME: Admits fresh live recordings before a continuously rotating archive.
// ABOUTME: Excludes visible recordings and preserves waiting work across pool updates.
export interface InstallationRecording<T> {
  id: string;
  live: boolean;
  value: T;
}

export class InstallationPlaybackQueue<T> {
  private recordings = new Map<string, InstallationRecording<T>>();
  private seen = new Set<string>();
  private playedLive = new Set<string>();

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
    for (const [id, recording] of incoming) this.recordings.set(id, recording);
  }

  take(activeIds: ReadonlySet<string>): T | null {
    const available = [...this.recordings.values()].filter(
      (recording) => !activeIds.has(recording.id),
    );
    let next =
      available.find(
        (recording) => recording.live && !this.playedLive.has(recording.id),
      ) ?? available.find((recording) => !this.seen.has(recording.id));
    if (!next && available.length > 0) {
      this.seen.clear();
      for (const id of activeIds) this.seen.add(id);
      next = available[0];
    }
    if (!next) return null;
    this.seen.add(next.id);
    if (next.live) this.playedLive.add(next.id);
    return next.value;
  }
}

export const INSTALLATION_ARRIVAL_MS = 1500;
export const INSTALLATION_TYPING_ARRIVAL_MS = 750;
export const INSTALLATION_FADE_MS = 2000;
export const INSTALLATION_SCROLL_HOLD_MS = 4000;
export const INSTALLATION_TYPING_HOLD_MS = 8000;
