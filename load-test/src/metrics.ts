// ABOUTME: Collects and computes metrics from virtual client events during a load test run.
// ABOUTME: Tracks latency percentiles, throughput, error rates, and degradation detection.

import type { ClientEvent } from "./client.js";

export interface LatencySnapshot {
  userCount: number;
  timestamp: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;       // 0-1
  propagationRate: number; // 0-1 (writes observed by others within timeout)
  writesPerSec: number;
  awarenessPerSec: number;
}

export interface RunSummary {
  degradationUserCount: number | null;
  hardLimitUserCount: number | null;
  snapshots: LatencySnapshot[];
  totalErrors: number;
  totalWrites: number;
  totalAwareness: number;
  durationMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export class MetricsCollector {
  private snapshots: LatencySnapshot[] = [];
  private windowMs = 5_000; // snapshot every 5s

  /** Compute a snapshot from a window of events across all clients. */
  snapshot(
    userCount: number,
    events: ClientEvent[],
    windowStart: number,
    windowEnd: number
  ): LatencySnapshot {
    const inWindow = events.filter(
      (e) => e.ts >= windowStart && e.ts < windowEnd
    );

    const rtts = inWindow
      .filter((e) => e.type === "write-received" && (e.data?.rttMs as number) > 0)
      .map((e) => e.data!.rttMs as number)
      .sort((a, b) => a - b);

    const writes = inWindow.filter((e) => e.type === "write");
    const timedOut = inWindow.filter(
      (e) => e.type === "write-received" && (e.data?.rttMs as number) === -1
    );
    const awareness = inWindow.filter((e) => e.type === "awareness-sent");
    const errors = inWindow.filter((e) => e.type === "disconnect" || e.type === "error");

    const totalExpected = writes.length + timedOut.length;
    const propagationRate = totalExpected > 0
      ? 1 - timedOut.length / totalExpected
      : 1;

    const windowSec = (windowEnd - windowStart) / 1000;

    const snap: LatencySnapshot = {
      userCount,
      timestamp: windowEnd,
      p50: percentile(rtts, 50),
      p95: percentile(rtts, 95),
      p99: percentile(rtts, 99),
      errorRate: userCount > 0 ? errors.length / userCount : 0,
      propagationRate,
      writesPerSec: writes.length / windowSec,
      awarenessPerSec: awareness.length / windowSec,
    };

    this.snapshots.push(snap);
    return snap;
  }

  /** Detect the user count at which p95 latency starts growing super-linearly. */
  detectDegradation(hardLimitMs = 2_000): {
    degradationUserCount: number | null;
    hardLimitUserCount: number | null;
  } {
    if (this.snapshots.length < 3) {
      return { degradationUserCount: null, hardLimitUserCount: null };
    }

    let degradationUserCount: number | null = null;
    let hardLimitUserCount: number | null = null;

    // Compute rate of change between consecutive snapshots
    for (let i = 2; i < this.snapshots.length; i++) {
      const prev = this.snapshots[i - 1];
      const curr = this.snapshots[i];

      if (hardLimitUserCount === null && curr.p95 >= hardLimitMs) {
        hardLimitUserCount = curr.userCount;
      }

      if (degradationUserCount === null) {
        const prevDelta = prev.p95 - this.snapshots[i - 2].p95;
        const currDelta = curr.p95 - prev.p95;
        // Inflection: current delta is >2x previous delta and latency is non-trivial
        if (currDelta > prevDelta * 2 && curr.p95 > 100) {
          degradationUserCount = curr.userCount;
        }
      }
    }

    return { degradationUserCount, hardLimitUserCount };
  }

  summarize(startMs: number): RunSummary {
    const { degradationUserCount, hardLimitUserCount } = this.detectDegradation();
    const allEvents = this.snapshots;

    return {
      degradationUserCount,
      hardLimitUserCount,
      snapshots: [...this.snapshots],
      totalErrors: allEvents.reduce((n, s) => n + Math.round(s.errorRate * s.userCount), 0),
      totalWrites: allEvents.reduce((n, s) => n + Math.round(s.writesPerSec * (this.windowMs / 1000)), 0),
      totalAwareness: allEvents.reduce((n, s) => n + Math.round(s.awarenessPerSec * (this.windowMs / 1000)), 0),
      durationMs: Date.now() - startMs,
    };
  }

  getSnapshots(): LatencySnapshot[] {
    return [...this.snapshots];
  }
}
