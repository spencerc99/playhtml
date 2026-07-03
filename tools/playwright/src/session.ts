// ABOUTME: Provides runtime helpers for bounded artificial-user scenes.
// ABOUTME: Keeps scene URLs and duration loops consistent across scenarios.

export interface RunUntil {
  active(): boolean;
  elapsedMs(): number;
  remainingMs(): number;
}

export function buildSceneUrl(
  baseUrl: string | undefined,
  pathOrUrl: string,
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (!baseUrl) return pathOrUrl;
  const base = baseUrl.replace(/\/+$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

export function createRunUntil(
  durationMs: number,
  now: () => number = Date.now,
): RunUntil {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("durationMs must be a positive number");
  }

  const startedAt = now();
  const endsAt = startedAt + durationMs;

  return {
    active() {
      return now() < endsAt;
    },
    elapsedMs() {
      return Math.max(0, now() - startedAt);
    },
    remainingMs() {
      return Math.max(0, endsAt - now());
    },
  };
}
