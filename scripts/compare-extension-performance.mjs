// ABOUTME: Compares extension trace summaries and writes report artifacts.
// ABOUTME: Flags large regressions while remaining report-only unless enforcement is requested.

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

function metricValue(summary, name) {
  const value = summary.meanMetrics?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function relativeChange(base, delta) {
  if (base === 0) return delta === 0 ? 0 : Number.POSITIVE_INFINITY;
  return delta / base;
}

function compareMetric(name, base, head, options) {
  const delta = head - base;
  const relative = relativeChange(base, delta);
  const minimumDelta = isHeapMetric(name) ? options.minHeapDelta : options.minDurationDelta;
  const exceedsRelative = relative > options.regressionThreshold;
  const exceedsAbsolute = delta > minimumDelta;
  const improvesRelative =
    Number.isFinite(relative) && Math.abs(relative) > options.regressionThreshold;
  const improvesAbsolute = Math.abs(delta) > minimumDelta;

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
    delta,
    relative,
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
      resolvedOptions,
    ),
  );
  const regressions = metrics.filter((metric) => metric.status === "regression");

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
    },
    metrics,
    regressions,
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

function statusText(status) {
  if (status === "regression") return "flagged";
  if (status === "improved") return "improved";
  return "ok";
}

export function formatMarkdownReport(comparison) {
  const lines = [
    "# Extension Performance Report",
    "",
    "Report-only: this comparison flags regressions but does not fail unless `--fail-on-regression` is used.",
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
    "| Metric | Base | Head | Change | Status |",
    "| --- | ---: | ---: | ---: | --- |",
  ];

  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.name} | ${formatMetricValue(metric, metric.base)} | ${formatMetricValue(
        metric,
        metric.head,
      )} | ${formatPercent(metric.relative)} (${formatSignedMetricValue(
        metric,
        metric.delta,
      )}) | ${statusText(metric.status)} |`,
    );
  }

  lines.push("", "## Flags", "");
  if (comparison.regressions.length === 0) {
    lines.push("No dramatic regressions were flagged.");
  } else {
    for (const metric of comparison.regressions) {
      lines.push(
        `- ${metric.name} increased by ${formatPercent(metric.relative)} (${formatSignedMetricValue(
          metric,
          metric.delta,
        )}).`,
      );
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
