// ABOUTME: Terminal output and comparison reporting for load test runs.
// ABOUTME: Prints live snapshots during runs and side-by-side diffs for comparisons.

import chalk from "chalk";
import type { LatencySnapshot, RunSummary } from "./metrics.js";
import type { RunRecord } from "./db.js";

function fmtMs(ms: number): string {
  if (ms <= 0) return chalk.gray("  n/a");
  if (ms < 200) return chalk.green(`${ms}ms`);
  if (ms < 500) return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

function fmtRate(rate: number): string {
  const pct = Math.round(rate * 100);
  if (pct >= 99) return chalk.green(`${pct}%`);
  if (pct >= 90) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}

export function printSnapshotHeader() {
  console.log(
    chalk.bold(
      `${"users".padEnd(8)}${"p50".padEnd(10)}${"p95".padEnd(10)}${"p99".padEnd(10)}${"propagation".padEnd(14)}${"writes/s".padEnd(12)}${"awareness/s"}`
    )
  );
  console.log("\u2500".repeat(75));
}

export function printSnapshot(snap: LatencySnapshot) {
  console.log(
    `${String(snap.userCount).padEnd(8)}${fmtMs(snap.p50).padEnd(18)}${fmtMs(snap.p95).padEnd(18)}${fmtMs(snap.p99).padEnd(18)}${fmtRate(snap.propagationRate).padEnd(22)}${snap.writesPerSec.toFixed(1).padEnd(12)}${snap.awarenessPerSec.toFixed(1)}`
  );
}

export function printSummary(scenario: string, target: string, summary: RunSummary) {
  console.log("\n" + chalk.bold(`=== ${scenario} (${target}) ===`));
  if (summary.degradationUserCount !== null) {
    console.log(
      chalk.yellow(`  Degradation detected at ${summary.degradationUserCount} users (p95 latency inflection)`)
    );
  } else {
    console.log(chalk.green("  No degradation detected within test range"));
  }
  if (summary.hardLimitUserCount !== null) {
    console.log(
      chalk.red(`  Hard limit (p95 > 2000ms) breached at ${summary.hardLimitUserCount} users`)
    );
  }
  console.log(`  Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Total writes: ${summary.totalWrites}`);
  console.log(`  Total awareness events: ${summary.totalAwareness}`);
  console.log(`  Total errors: ${summary.totalErrors}`);
}

export function printComparison(runA: RunRecord, runB: RunRecord) {
  const a = runA.summary;
  const b = runB.summary;

  console.log(chalk.bold("\n=== Comparison ==="));
  console.log(
    `  ${chalk.cyan("A")} run ${runA.id} \u2014 ${runA.scenario} @ ${runA.target} (${new Date(runA.timestamp).toLocaleString()}) git:${runA.gitCommit ?? "unknown"}`
  );
  console.log(
    `  ${chalk.magenta("B")} run ${runB.id} \u2014 ${runB.scenario} @ ${runB.target} (${new Date(runB.timestamp).toLocaleString()}) git:${runB.gitCommit ?? "unknown"}`
  );
  console.log("\u2500".repeat(60));

  function diffVal(label: string, aVal: number | null, bVal: number | null, lowerIsBetter = true) {
    const aStr = aVal !== null ? String(aVal) : "n/a";
    const bStr = bVal !== null ? String(bVal) : "n/a";
    let delta = "";
    if (aVal !== null && bVal !== null) {
      const diff = bVal - aVal;
      const improved = lowerIsBetter ? diff < 0 : diff > 0;
      delta = improved
        ? chalk.green(` (${diff > 0 ? "+" : ""}${diff})`)
        : chalk.red(` (${diff > 0 ? "+" : ""}${diff})`);
    }
    console.log(`  ${label.padEnd(30)} A: ${aStr.padEnd(10)} B: ${bStr}${delta}`);
  }

  diffVal("Degradation user count", a.degradationUserCount, b.degradationUserCount, false);
  diffVal("Hard limit user count", a.hardLimitUserCount, b.hardLimitUserCount, false);
  diffVal("Total errors", a.totalErrors, b.totalErrors);
}

export function printHistory(runs: RunRecord[]) {
  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }
  console.log(chalk.bold(`\n${"id".padEnd(12)}${"scenario".padEnd(16)}${"target".padEnd(12)}${"users@degrade".padEnd(16)}${"users@limit".padEnd(14)}${"git".padEnd(10)}date`));
  console.log("\u2500".repeat(90));
  for (const r of runs) {
    console.log(
      `${r.id.slice(0, 10).padEnd(12)}${r.scenario.padEnd(16)}${r.target.padEnd(12)}${String(r.summary.degradationUserCount ?? "\u2014").padEnd(16)}${String(r.summary.hardLimitUserCount ?? "\u2014").padEnd(14)}${(r.gitCommit ?? "unknown").padEnd(10)}${new Date(r.timestamp).toLocaleString()}`
    );
  }
}
