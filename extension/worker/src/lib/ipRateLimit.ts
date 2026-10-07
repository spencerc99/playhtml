// ABOUTME: Provides bounded per-IP request limiting for public Worker routes.
// ABOUTME: Keeps recent request timestamps in each Cloudflare Worker isolate.

const MAX_TRACKED_IPS = 10_000;

export function createIpRateLimiter(maxRequests: number, windowMs: number) {
  const ipHits = new Map<string, number[]>();

  return {
    isLimited(ip: string, now: number): boolean {
      const cutoff = now - windowMs;
      const hits = (ipHits.get(ip) || []).filter((timestamp) => timestamp > cutoff);
      if (hits.length >= maxRequests) {
        ipHits.set(ip, hits);
        return true;
      }

      hits.push(now);
      ipHits.set(ip, hits);
      if (ipHits.size > MAX_TRACKED_IPS) {
        const toDrop = Math.floor(MAX_TRACKED_IPS / 2);
        let dropped = 0;
        for (const key of ipHits.keys()) {
          if (dropped++ >= toDrop) break;
          ipHits.delete(key);
        }
      }

      return false;
    },

    reset(): void {
      ipHits.clear();
    },
  };
}
