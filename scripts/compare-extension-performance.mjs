// ABOUTME: Compares extension trace summaries and writes report artifacts.
// ABOUTME: Flags large regressions and fails when --fail-on-regression is passed.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_METRICS = [
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "JSHeapUsedSize",
];

const DEFAULT_OPTIONS = {
  baseLabel: "base",
  headLabel: "head",
  regressionThreshold: 0.25,
  minDurationDelta: 0.05,
  minHeapDelta: 5 * 1024 * 1024,
  heapNoiseFloor: 256 * 1024,
  failOnRegression: false,
};

function parseNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--summary") {
      args.summaryPath = argv[++i];
    } else if (arg === "--out-dir") {
      args.outDir = argv[++i];
    } else if (arg === "--base-label") {
      args.baseLabel = argv[++i];
    } else if (arg === "--head-label") {
      args.headLabel = argv[++i];
    } else if (arg === "--regression-threshold") {
      args.regressionThreshold = parseNumber(argv[++i], "--regression-threshold");
    } else if (arg === "--min-duration-delta") {
      args.minDurationDelta = parseNumber(argv[++i], "--min-duration-delta");
    } else if (arg === "--min-heap-delta") {
      args.minHeapDelta = parseNumber(argv[++i], "--min-heap-delta");
    } else if (arg === "--heap-noise-floor") {
      args.heapNoiseFloor = parseNumber(argv[++i], "--heap-noise-floor");
    } else if (arg === "--markdown-path") {
      args.markdownPath = argv[++i];
    } else if (arg === "--json-path") {
      args.jsonPath = argv[++i];
    } else if (arg === "--fail-on-regression") {
      args.failOnRegression = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.summaryPath) {
    throw new Error("Pass --summary /path/to/summary.json");
  }

  const defaultOutDir = dirname(resolve(args.summaryPath));
  args.outDir = resolve(args.outDir ?? defaultOutDir);
  args.markdownPath = resolve(args.markdownPath ?? resolve(args.outDir, "report.md"));
  args.jsonPath = resolve(args.jsonPath ?? resolve(args.outDir, "comparison.json"));

  return args;
}

function isHeapMetric(name) {
  return name === "JSHeapUsedSize";
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Heap is the median of runs so one run that caught V8 mid-cleanup can't move
// it. Durations keep the mean.
function metricValue(summary, name) {
  const source = isHeapMetric(name) ? summary.medianMetrics : summary.meanMetrics;
  return finiteOrNull(source?.[name]);
}

function metricSpread(summary, name) {
  return finiteOrNull(summary.metricSpread?.[name]);
}

function relativeChange(base, delta) {
  if (base === 0) return delta === 0 ? 0 : Number.POSITIVE_INFINITY;
  return delta / base;
}

// The smallest change the report treats as real. Durations use the same floor
// that gates flags. Heap also widens to the run-to-run spread actually
// observed, so a difference smaller than the runs disagree with each other
// reads as noise.
function noiseFloor(name, baseSpread, headSpread, options) {
  if (!isHeapMetric(name)) return options.minDurationDelta;
  return Math.max(options.heapNoiseFloor, baseSpread ?? 0, headSpread ?? 0);
}

function isInvalidValue(name, value) {
  // A live page always has a JS heap, and no duration can be negative.
  return isHeapMetric(name) ? value <= 0 : value < 0;
}

function compareMetric(name, base, head, baseSpread, headSpread, options) {
  const spreads = { baseSpread, headSpread };
  // A metric either trace stopped reporting is flagged so the check can't
  // pass on missing data.
  if (base === null || head === null) {
    return { name, base, head, ...spreads, delta: null, relative: null, status: "missing" };
  }
  if (isInvalidValue(name, base) || isInvalidValue(name, head)) {
    return { name, base, head, ...spreads, delta: null, relative: null, status: "invalid" };
  }
  const delta = head - base;
  const relative = relativeChange(base, delta);
  const noise = noiseFloor(name, baseSpread, headSpread, options);
  const withinNoise = Math.abs(delta) <= noise;
  const minimumDelta = isHeapMetric(name) ? options.minHeapDelta : options.minDurationDelta;
  const exceedsRelative = relative > options.regressionThreshold;
  const exceedsAbsolute = delta > minimumDelta && !withinNoise;
  const improvesRelative =
    Number.isFinite(relative) && Math.abs(relative) > options.regressionThreshold;
  const improvesAbsolute = Math.abs(delta) > minimumDelta && !withinNoise;

  let status = "ok";
  if (exceedsRelative && exceedsAbsolute) {
    status = "regression";
  } else if (delta < 0 && improvesRelative && improvesAbsolute) {
    status = "improved";
  }

  return {
    name,
    base,
    head,
    ...spreads,
    delta,
    relative,
    noiseFloor: noise,
    withinNoise,
    // A percent of a base that is itself under the noise floor says nothing.
    showRelative: !withinNoise && base > noise,
    status,
  };
}

function findSummary(traceSummary, label) {
  const summary = traceSummary.summary?.find((item) => item.label === label);
  if (!summary) {
    const labels = traceSummary.summary?.map((item) => item.label).join(", ") || "none";
    throw new Error(`Could not find label "${label}" in trace summary. Available labels: ${labels}`);
  }
  return summary;
}

export function compareSummaries(traceSummary, options = {}) {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const baseSummary = findSummary(traceSummary, resolvedOptions.baseLabel);
  const headSummary = findSummary(traceSummary, resolvedOptions.headLabel);

  const metrics = DEFAULT_METRICS.map((name) =>
    compareMetric(
      name,
      metricValue(baseSummary, name),
      metricValue(headSummary, name),
      metricSpread(baseSummary, name),
      metricSpread(headSummary, name),
      resolvedOptions,
    ),
  );
  const regressions = metrics.filter((metric) => metric.status !== "ok" && metric.status !== "improved");

  return {
    createdAt: new Date().toISOString(),
    sourceCreatedAt: traceSummary.createdAt,
    baseLabel: resolvedOptions.baseLabel,
    headLabel: resolvedOptions.headLabel,
    baseRuns: baseSummary.runs,
    headRuns: headSummary.runs,
    thresholds: {
      regressionThreshold: resolvedOptions.regressionThreshold,
      minDurationDelta: resolvedOptions.minDurationDelta,
      minHeapDelta: resolvedOptions.minHeapDelta,
      heapNoiseFloor: resolvedOptions.heapNoiseFloor,
    },
    metrics,
    regressions,
    enforced: resolvedOptions.failOnRegression,
    traceFiles: {
      base: baseSummary.traces ?? [],
      head: headSummary.traces ?? [],
    },
    headTopRendererEvents: headSummary.topRendererEvents ?? [],
  };
}

function formatDuration(value) {
  return `${value.toFixed(3)}s`;
}

function formatHeap(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatMetricValue(metric, value) {
  return isHeapMetric(metric.name) ? formatHeap(value) : formatDuration(value);
}

function formatSignedMetricValue(metric, value) {
  const formatted = formatMetricValue(metric, Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return value > 0 ? "+∞%" : "0.0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatChange(metric) {
  if (metric.delta === null) return "n/a";
  const absolute = formatSignedMetricValue(metric, metric.delta);
  if (metric.withinNoise) return `${absolute} (within noise)`;
  if (metric.showRelative) return `${absolute} (${formatPercent(metric.relative)})`;
  return absolute;
}

function formatOptionalValue(metric, value) {
  return value === null ? "n/a" : formatMetricValue(metric, value);
}

function formatSpread(metric) {
  return `${formatOptionalValue(metric, metric.baseSpread)} / ${formatOptionalValue(
    metric,
    metric.headSpread,
  )}`;
}

function statusText(status) {
  if (status === "regression") return "flagged";
  if (status === "missing") return "missing";
  if (status === "invalid") return "invalid";
  if (status === "improved") return "improved";
  return "ok";
}

export const REPORT_MARKER = "<!-- extension-performance-report -->";

function resultLine(comparison) {
  const count = comparison.regressions.length;
  if (count === 0) return "**Result:** no regressions flagged.";
  const flagged = `${count} metric${count === 1 ? "" : "s"} flagged`;
  return comparison.enforced
    ? `**Result:** ${flagged}. This check fails until the regression is fixed.`
    : `**Result:** ${flagged} (report-only, the check still passes).`;
}

export function formatMarkdownReport(comparison) {
  const lines = [
    REPORT_MARKER,
    "# Extension Performance Report",
    "",
    resultLine(comparison),
    "",
    `Compared \`${comparison.baseLabel}\` (${comparison.baseRuns} run${
      comparison.baseRuns === 1 ? "" : "s"
    }) to \`${comparison.headLabel}\` (${comparison.headRuns} run${
      comparison.headRuns === 1 ? "" : "s"
    }).`,
    "",
    `Threshold: >${(comparison.thresholds.regressionThreshold * 100).toFixed(
      1,
    )}% and >${formatDuration(
      comparison.thresholds.minDurationDelta,
    )} for duration metrics, or >${formatHeap(comparison.thresholds.minHeapDelta)} for heap.`,
    "",
    `Durations are the mean change across the scenario. JSHeapUsedSize is the page's live JS heap (page plus content scripts) after a forced garbage collection at the end of the scenario, median of runs. A change no larger than ${formatDuration(
      comparison.thresholds.minDurationDelta,
    )} for durations, or the larger of ${formatHeap(
      comparison.thresholds.heapNoiseFloor,
    )} and the run spread for heap, is shown as within noise. Run spread is the largest minus the smallest run.`,
    "",
    "| Metric | Base | Head | Change | Run spread (base / head) | Status |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.name} | ${formatOptionalValue(metric, metric.base)} | ${formatOptionalValue(
        metric,
        metric.head,
      )} | ${formatChange(metric)} | ${formatSpread(metric)} | ${statusText(metric.status)} |`,
    );
  }

  lines.push("", "## Flags", "");
  if (comparison.regressions.length === 0) {
    lines.push("No dramatic regressions were flagged.");
  } else {
    for (const metric of comparison.regressions) {
      if (metric.status === "missing") {
        const sides = [
          metric.base === null ? `\`${comparison.baseLabel}\`` : null,
          metric.head === null ? `\`${comparison.headLabel}\`` : null,
        ].filter(Boolean);
        lines.push(`- ${metric.name} was not reported by the ${sides.join(" and ")} trace.`);
        continue;
      }
      if (metric.status === "invalid") {
        lines.push(
          `- ${metric.name} has an impossible value (base ${formatMetricValue(
            metric,
            metric.base,
          )}, head ${formatMetricValue(metric, metric.head)}), so the measurement is broken.`,
        );
        continue;
      }
      lines.push(`- ${metric.name} increased by ${formatChange(metric)}.`);
    }
  }

  lines.push("", "## Head Top Renderer Events", "");
  if (comparison.headTopRendererEvents.length === 0) {
    lines.push("No renderer event summary was available.");
  } else {
    lines.push("| Event | Duration |", "| --- | ---: |");
    for (const event of comparison.headTopRendererEvents.slice(0, 8)) {
      lines.push(`| ${event.name} | ${event.durationMs.toFixed(1)}ms |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summaryText = await readFile(args.summaryPath, "utf8");
  const traceSummary = JSON.parse(summaryText);
  const comparison = compareSummaries(traceSummary, args);
  const markdown = formatMarkdownReport(comparison);

  await mkdir(args.outDir, { recursive: true });
  await writeFile(args.jsonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  await writeFile(args.markdownPath, markdown);

  console.log(markdown);
  console.log(`Comparison JSON: ${args.jsonPath}`);
  console.log(`Comparison report: ${args.markdownPath}`);

  if (args.failOnRegression && comparison.regressions.length > 0) {
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === executedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
