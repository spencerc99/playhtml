// ABOUTME: Compares playhtml client benchmark results (bundle size plus bench/client.perf.ts counts).
// ABOUTME: Writes a PR comment report and fails on regressions when --fail-on-regression is passed.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPORT_MARKER = "<!-- library-performance-report -->";

// Lower is better for every metric. The benchmark is deterministic, so thresholds
// only need to leave room for intentional growth, not for runner noise.
export const METRICS = [
  {
    key: "bundle_gz_kb",
    label: "Bundle size (gzip)",
    unit: "KB",
    maxRelative: 0.02,
    minAbsolute: 0.5,
  },
  {
    key: "bundle_raw_kb",
    label: "Bundle size (raw)",
    unit: "KB",
    maxRelative: 0.05,
    minAbsolute: 2,
  },
  {
    key: "stream_msgs",
    label: "can-play stream: messages",
    unit: "",
    maxRelative: 0.1,
    minAbsolute: 1,
  },
  {
    key: "stream_bytes",
    label: "can-play stream: bytes sent",
    unit: "B",
    maxRelative: 0.1,
    minAbsolute: 256,
  },
  {
    key: "stream_doc_growth",
    label: "can-play stream: doc growth",
    unit: "B",
    maxRelative: 0.1,
    minAbsolute: 256,
  },
  {
    key: "append_bytes",
    label: "List append: bytes sent",
    unit: "B",
    maxRelative: 0.1,
    minAbsolute: 256,
  },
  {
    key: "append_doc_growth",
    label: "List append: doc growth",
    unit: "B",
    maxRelative: 0.1,
    minAbsolute: 256,
  },
  {
    key: "edit_bytes",
    label: "List edit: bytes sent",
    unit: "B",
    maxRelative: 0.1,
    minAbsolute: 256,
  },
  {
    key: "edit_doc_growth",
    label: "List edit: doc growth",
    unit: "B",
    maxRelative: 0.1,
    minAbsolute: 256,
  },
  {
    key: "fanout_renders",
    label: "Remote update: renders",
    unit: "",
    maxRelative: 0.1,
    minAbsolute: 1,
  },
  {
    key: "init_qsa_calls",
    label: "Init: DOM scans",
    unit: "",
    maxRelative: 0.1,
    minAbsolute: 1,
  },
];

function parseArgs(argv) {
  const args = { failOnRegression: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") args.basePath = argv[++i];
    else if (arg === "--head") args.headPath = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--fail-on-regression") args.failOnRegression = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.basePath || !args.headPath) {
    throw new Error("Pass --base /path/to/base.json --head /path/to/head.json");
  }
  args.outDir = resolve(args.outDir ?? dirname(resolve(args.headPath)));
  return args;
}

function compareMetric(metric, base, head) {
  if (typeof base !== "number" || typeof head !== "number") {
    return {
      ...metric,
      base,
      head,
      delta: null,
      relative: null,
      status: "missing",
    };
  }
  const delta = head - base;
  const relative =
    base === 0 ? (delta === 0 ? 0 : Number.POSITIVE_INFINITY) : delta / base;
  const beyond =
    Math.abs(relative) > metric.maxRelative &&
    Math.abs(delta) >= metric.minAbsolute;
  let status = "ok";
  if (beyond && delta > 0) status = "regression";
  else if (beyond && delta < 0) status = "improved";
  return { ...metric, base, head, delta, relative, status };
}

export function compareResults(base, head, options = {}) {
  const metrics = METRICS.map((metric) =>
    compareMetric(metric, base[metric.key], head[metric.key]),
  );
  return {
    metrics,
    regressions: metrics.filter((metric) => metric.status === "regression"),
    enforced: Boolean(options.failOnRegression),
  };
}

function formatValue(metric, value) {
  if (typeof value !== "number") return "n/a";
  const rounded =
    metric.unit === "KB" ? value.toFixed(1) : String(Math.round(value));
  return metric.unit ? `${rounded} ${metric.unit}` : rounded;
}

function formatChange(metric) {
  if (metric.delta === null) return "n/a";
  if (metric.delta === 0) return "no change";
  const sign = metric.delta > 0 ? "+" : "-";
  const percent = Number.isFinite(metric.relative)
    ? `${sign}${Math.abs(metric.relative * 100).toFixed(1)}%`
    : "new";
  return `${percent} (${sign}${formatValue(metric, Math.abs(metric.delta))})`;
}

function formatThreshold(metric) {
  const absolute = metric.unit
    ? `${metric.minAbsolute} ${metric.unit}`
    : String(metric.minAbsolute);
  return `>${(metric.maxRelative * 100).toFixed(0)}% and >=${absolute}`;
}

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
    "# Library Performance Report",
    "",
    resultLine(comparison),
    "",
    "Compares `main` to this PR on the playhtml bundle a page downloads and the client benchmark in `packages/playhtml/bench/`. Lower is better. The benchmark is deterministic, so any change is real.",
    "",
    "| Metric | main | This PR | Change | Flag if | Status |",
    "| --- | ---: | ---: | ---: | --- | --- |",
  ];
  for (const metric of comparison.metrics) {
    const status =
      metric.status === "regression" ? "**flagged**" : metric.status;
    lines.push(
      `| ${metric.label} | ${formatValue(metric, metric.base)} | ${formatValue(
        metric,
        metric.head,
      )} | ${formatChange(metric)} | ${formatThreshold(metric)} | ${status} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = JSON.parse(await readFile(args.basePath, "utf8"));
  const head = JSON.parse(await readFile(args.headPath, "utf8"));
  const comparison = compareResults(base, head, args);
  const markdown = formatMarkdownReport(comparison);

  await mkdir(args.outDir, { recursive: true });
  await writeFile(
    resolve(args.outDir, "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`,
  );
  await writeFile(resolve(args.outDir, "report.md"), markdown);
  console.log(markdown);

  if (args.failOnRegression && comparison.regressions.length > 0) {
    process.exitCode = 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === executedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
