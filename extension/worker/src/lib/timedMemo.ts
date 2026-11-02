// ABOUTME: Shares one in-flight load per isolate and reuses its result for a short time.
// ABOUTME: Lets public routes absorb bursts of identical requests without repeating database work.

export interface TimedMemo<T> {
  /** Returns the fresh cached value, joins a load in flight, or starts `load`. */
  get(load: () => Promise<T>): Promise<T>;
  clear(): void;
}

type MemoEntry<T> =
  | { state: 'loading'; promise: Promise<T>; startedAt: number }
  | { state: 'ready'; value: T; expiresAt: number };

export function createTimedMemo<T>({
  ttlMs,
  abandonLoadAfterMs,
  now = () => Date.now(),
}: {
  /** How long a loaded value is served, counted from when its load finished. */
  ttlMs: number;
  /**
   * A load started by a request the runtime later canceled may never settle.
   * Callers arriving after this long start a fresh load instead of joining it.
   */
  abandonLoadAfterMs: number;
  now?: () => number;
}): TimedMemo<T> {
  let entry: MemoEntry<T> | null = null;

  return {
    get(load) {
      const startedAt = now();
      if (entry?.state === 'ready' && startedAt < entry.expiresAt) {
        return Promise.resolve(entry.value);
      }
      if (
        entry?.state === 'loading' &&
        startedAt - entry.startedAt < abandonLoadAfterMs
      ) {
        return entry.promise;
      }

      const promise = load();
      const loading: MemoEntry<T> = { state: 'loading', promise, startedAt };
      entry = loading;
      promise.then(
        (value) => {
          if (entry === loading) {
            entry = { state: 'ready', value, expiresAt: now() + ttlMs };
          }
        },
        () => {
          // Failures are never cached; the caller sees the rejection and the
          // next request retries.
          if (entry === loading) entry = null;
        },
      );
      return promise;
    },
    clear() {
      entry = null;
    },
  };
}
