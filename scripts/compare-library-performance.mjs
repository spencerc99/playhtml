// ABOUTME: Compares playhtml client benchmark results (bundle size, render/traffic counts, timings).
// ABOUTME: Writes a PR comment report and fails on regressions when --fail-on-regression is passed.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPORT_MARKER = "<!-- library-performance-report -->";

// Lower is better for every metric. The benchmark is deterministic, so thresholds
// only need to leave room for intentional growth, not for runner noise. A count
// whose baseline is 0 (renders that should never happen) is flagged at +1.
// Timings (`infoOnly`) are shown for context but never flagged: they run in
// jsdom and vary with the CI runner.
const count = (key, label) => ({
  key,
  label,
  unit: "",
  maxRelative: 0.1,
  minAbsolute: 1,
});
const bytes = (key, label) => ({
  key,
  label,
  unit: "B",
  maxRelative: 0.1,
  minAbsolute: 256,
});
const timing = (key, label) => ({ key, label, unit: "ms", infoOnly: true });

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
  count("stream_msgs", "can-play stream: messages"),
  bytes("stream_bytes", "can-play stream: bytes sent"),
  bytes("stream_doc_growth", "can-play stream: doc growth"),
  bytes("append_bytes", "List append: bytes sent"),
  bytes("append_doc_growth", "List append: doc growth"),
  bytes("edit_bytes", "List edit: bytes sent"),
  bytes("edit_doc_growth", "List edit: doc growth"),
  count("local_write_renders", "Own setData x50: updateElement calls"),
  count("fanout_renders", "100 remote updates: updateElement calls"),
  count("drag_msgs", "can-move 2s drag: messages"),
  bytes("drag_bytes", "can-move 2s drag: bytes sent"),
  count(
    "presence_unrelated_listener_calls",
    "20 cursors moving: unrelated presence listener calls",
  ),
  count("presence_dom_writes", "20 cursors moving: cursor DOM writes"),
  count("presence_msgs_sent", "Own cursor 5s: presence messages"),
  bytes("presence_bytes_sent", "Own cursor 5s: presence bytes"),
  count("init_qsa_calls", "Init 200 elements: DOM scans"),
  count("init_1000_qsa_calls", "Init 1,000 elements: DOM scans"),
  count("init_1000_listeners", "Init 1,000 elements: event listeners"),
  count(
    "react_remote_own_renders",
    "React, 20 remote edits: edited card renders",
  ),
  count(
    "react_remote_unrelated_renders",
    "React, 20 remote edits: other component renders",
  ),
  count("react_local_own_renders", "React, 20 own edits: edited card renders"),
  count(
    "react_local_unrelated_renders",
    "React, 20 own edits: other component renders",
  ),
  count(
    "react_presence_card_renders",
    "React, 20 cursors moving: card renders",
  ),
  count(
    "react_presence_status_renders",
    'React, 20 cursors moving: usePresence("status") renders',
  ),
  timing("init_1000_ms", "Init 1,000 elements: time (median of 5)"),
  timing("react_mount_50_ms", "React, mount 50 cards: time (median of 5)"),
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

const isMeasured = (value) =>
  typeof value === "number" && Number.isFinite(value);

function compareMetric(metric, base, head) {
  // A tracked metric the PR stopped emitting fails the check so coverage can't
  // silently drop. One that only base lacks is new in this PR and passes.
  if (!isMeasured(head) || !isMeasured(base)) {
    return {
      ...metric,
      base,
      head,
      delta: null,
      relative: null,
      status: isMeasured(head) || metric.infoOnly ? "new" : "missing",
    };
  }
  const delta = head - base;
  if (metric.infoOnly) {
    const relative = base === 0 ? 0 : delta / base;
    return { ...metric, base, head, delta, relative, status: "info" };
  }
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
    missing: metrics.filter((metric) => metric.status === "missing"),
    enforced: Boolean(options.failOnRegression),
  };
}

function formatValue(metric, value) {
  if (!isMeasured(value)) return "n/a";
  const rounded =
    metric.unit === "KB" || metric.unit === "ms"
      ? value.toFixed(1)
      : String(Math.round(value));
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
  if (metric.infoOnly) return "info only";
  const absolute = metric.unit
    ? `${metric.minAbsolute} ${metric.unit}`
    : String(metric.minAbsolute);
  return `>${(metric.maxRelative * 100).toFixed(0)}% and >=${absolute}`;
}

export function failureCount(comparison) {
  return comparison.regressions.length + comparison.missing.length;
}

function resultLine(comparison) {
  const count = failureCount(comparison);
  if (count === 0) return "**Result:** no regressions flagged.";
  const parts = [];
  if (comparison.regressions.length > 0) {
    const n = comparison.regressions.length;
    parts.push(`${n} metric${n === 1 ? "" : "s"} flagged`);
  }
  if (comparison.missing.length > 0) {
    const names = comparison.missing
      .map((metric) => `\`${metric.key}\``)
      .join(", ");
    parts.push(`the benchmark no longer reports ${names}`);
  }
  const flagged = parts.join("; ");
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
    "Compares `main` to this PR on the bundle a page downloads and common paths in `packages/playhtml/bench/` and `packages/react/bench/`: sync traffic, renders, drags, presence and init. Lower is better. Counts are stable between runs, so a change past the threshold is real. Timings are info only.",
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

  if (args.failOnRegression && failureCount(comparison) > 0) {
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
