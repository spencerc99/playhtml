// ABOUTME: Tests extension performance comparison thresholds and report text.
// ABOUTME: Keeps the PR comment and enforcement behavior stable without launching a browser.

import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSummaries,
  formatMarkdownReport,
} from "./compare-extension-performance.mjs";

const MB = 1024 * 1024;

function traceSummary() {
  return {
    createdAt: "2026-06-12T00:00:00.000Z",
    summary: [
      {
        label: "base",
        runs: 1,
        meanMetrics: {
          TaskDuration: 1,
          ScriptDuration: 0.4,
          LayoutDuration: 0.01,
          RecalcStyleDuration: 0.01,
        },
        medianMetrics: { JSHeapUsedSize: 10 * MB },
        metricSpread: {
          TaskDuration: 0.02,
          ScriptDuration: 0.01,
          LayoutDuration: 0.001,
          RecalcStyleDuration: 0.001,
          JSHeapUsedSize: 0.02 * MB,
        },
        traces: ["base.trace.json"],
        topRendererEvents: [],
      },
      {
        label: "head",
        runs: 1,
        meanMetrics: {
          TaskDuration: 1.4,
          ScriptDuration: 0.41,
          LayoutDuration: 0.011,
          RecalcStyleDuration: 0.011,
        },
        medianMetrics: { JSHeapUsedSize: 17 * MB },
        metricSpread: {
          TaskDuration: 0.03,
          ScriptDuration: 0.01,
          LayoutDuration: 0.001,
          RecalcStyleDuration: 0.001,
          JSHeapUsedSize: 0.03 * MB,
        },
        traces: ["head.trace.json"],
        topRendererEvents: [{ name: "FunctionCall", durationMs: 52.5 }],
      },
    ],
  };
}

test("flags substantial regressions while ignoring tiny deltas", () => {
  const comparison = compareSummaries(traceSummary(), {
    baseLabel: "base",
    headLabel: "head",
    regressionThreshold: 0.25,
    minDurationDelta: 0.05,
    minHeapDelta: 5 * 1024 * 1024,
  });

  assert.deepEqual(
    comparison.regressions.map((metric) => metric.name),
    ["TaskDuration", "JSHeapUsedSize"],
  );
  assert.equal(
    comparison.metrics.find((metric) => metric.name === "ScriptDuration")
      .status,
    "ok",
  );
  assert.equal(
    comparison.metrics.find((metric) => metric.name === "LayoutDuration")
      .status,
    "ok",
  );
});

test("formats a report-only markdown table", () => {
  const comparison = compareSummaries(traceSummary(), {
    baseLabel: "base",
    headLabel: "head",
    regressionThreshold: 0.25,
    minDurationDelta: 0.05,
    minHeapDelta: 5 * 1024 * 1024,
  });

  const markdown = formatMarkdownReport(comparison);

  assert.match(markdown, /# Extension Performance Report/);
  assert.match(markdown, /<!-- extension-performance-report -->/);
  assert.match(markdown, /2 metrics flagged \(report-only/);
  assert.match(
    markdown,
    /\| TaskDuration \| 1\.000s \| 1\.400s \| \+0\.400s \(\+40\.0%\) \| 0\.020s \/ 0\.030s \| flagged \|/,
  );
  assert.match(
    markdown,
    /\| JSHeapUsedSize \| 10\.00 MB \| 17\.00 MB \| \+7\.00 MB \(\+70\.0%\) \| 0\.02 MB \/ 0\.03 MB \| flagged \|/,
  );
  assert.match(
    markdown,
    /\| ScriptDuration \| 0\.400s \| 0\.410s \| \+0\.010s \(within noise\) \|/,
  );
  assert.match(markdown, /FunctionCall/);
});

test("reports enforcement when failing on regression", () => {
  const comparison = compareSummaries(traceSummary(), {
    failOnRegression: true,
  });

  const markdown = formatMarkdownReport(comparison);

  assert.equal(comparison.enforced, true);
  assert.match(markdown, /2 metrics flagged\. This check fails/);
});

test("flags a metric the head trace stopped reporting", () => {
  const summary = traceSummary();
  const head = summary.summary.find((item) => item.label === "head");
  delete head.meanMetrics.ScriptDuration;

  const comparison = compareSummaries(summary, { failOnRegression: true });

  assert.equal(
    comparison.metrics.find((metric) => metric.name === "ScriptDuration")
      .status,
    "missing",
  );
  assert.match(
    formatMarkdownReport(comparison),
    /ScriptDuration was not reported by the `head` trace/,
  );
});

function withHeap(
  summary,
  base,
  head,
  { baseSpread = 0.02 * MB, headSpread = 0.02 * MB } = {},
) {
  const [baseSummary, headSummary] = summary.summary;
  baseSummary.medianMetrics.JSHeapUsedSize = base;
  headSummary.medianMetrics.JSHeapUsedSize = head;
  baseSummary.metricSpread.JSHeapUsedSize = baseSpread;
  headSummary.metricSpread.JSHeapUsedSize = headSpread;
  return summary;
}

function heapMetric(comparison) {
  return comparison.metrics.find((metric) => metric.name === "JSHeapUsedSize");
}

test("shows a small change on a tiny base as noise with no percent", () => {
  // The values PR #657 reported under the old before/after heap delta.
  const comparison = compareSummaries(
    withHeap(traceSummary(), 0.25 * MB, 0.39 * MB),
  );
  const heap = heapMetric(comparison);

  assert.equal(heap.status, "ok");
  assert.equal(heap.withinNoise, true);
  assert.equal(heap.showRelative, false);
  const markdown = formatMarkdownReport(comparison);
  assert.match(
    markdown,
    /\| JSHeapUsedSize \| 0\.25 MB \| 0\.39 MB \| \+0\.14 MB \(within noise\) \|/,
  );
  assert.doesNotMatch(markdown, /57\.\d%/);
});

test("drops the percent for a real change on a duration base under the noise floor", () => {
  const summary = traceSummary();
  summary.summary[0].meanMetrics.LayoutDuration = 0.01;
  summary.summary[1].meanMetrics.LayoutDuration = 0.09;

  const layout = compareSummaries(summary).metrics.find(
    (metric) => metric.name === "LayoutDuration",
  );

  assert.equal(layout.withinNoise, false);
  assert.equal(layout.showRelative, false);
  assert.match(
    formatMarkdownReport(compareSummaries(summary)),
    /\| LayoutDuration \| 0\.010s \| 0\.090s \| \+0\.080s \| /,
  );
});

test("treats a heap change inside the observed run spread as noise", () => {
  const comparison = compareSummaries(
    withHeap(traceSummary(), 30 * MB, 36 * MB, {
      baseSpread: 0.1 * MB,
      headSpread: 8 * MB,
    }),
  );
  const heap = heapMetric(comparison);

  assert.equal(heap.withinNoise, true);
  assert.equal(heap.status, "ok");
});

test("flags a negative heap value as a broken measurement", () => {
  const comparison = compareSummaries(
    withHeap(traceSummary(), 0.18 * MB, -0.11 * MB),
    {
      failOnRegression: true,
    },
  );

  assert.equal(heapMetric(comparison).status, "invalid");
  assert.ok(
    comparison.regressions.some((metric) => metric.name === "JSHeapUsedSize"),
  );
  const markdown = formatMarkdownReport(comparison);
  assert.match(
    markdown,
    /\| JSHeapUsedSize \| 0\.18 MB \| -0\.11 MB \| n\/a \| .* \| invalid \|/,
  );
  assert.match(
    markdown,
    /JSHeapUsedSize has an impossible value .* so the measurement is broken/,
  );
});

test("flags a zero heap value as a broken measurement", () => {
  const comparison = compareSummaries(withHeap(traceSummary(), 0, 12 * MB));

  assert.equal(heapMetric(comparison).status, "invalid");
  assert.doesNotMatch(formatMarkdownReport(comparison), /∞/);
});

test("still flags a real heap regression", () => {
  const comparison = compareSummaries(
    withHeap(traceSummary(), 30 * MB, 40 * MB),
    {
      failOnRegression: true,
    },
  );

  assert.equal(heapMetric(comparison).status, "regression");
  const markdown = formatMarkdownReport(comparison);
  assert.match(
    markdown,
    /\| JSHeapUsedSize \| 30\.00 MB \| 40\.00 MB \| \+10\.00 MB \(\+33\.3%\) \|/,
  );
  assert.match(
    markdown,
    /- JSHeapUsedSize increased by \+10\.00 MB \(\+33\.3%\)\./,
  );
});

test("does not flag a heap growth under the 5 MB regression rule", () => {
  const comparison = compareSummaries(withHeap(traceSummary(), 4 * MB, 8 * MB));
  const heap = heapMetric(comparison);

  assert.equal(heap.status, "ok");
  assert.equal(heap.showRelative, true);
});

test("flags a heap median the base trace did not report", () => {
  const summary = traceSummary();
  delete summary.summary[0].medianMetrics.JSHeapUsedSize;

  const comparison = compareSummaries(summary);

  assert.equal(heapMetric(comparison).status, "missing");
  assert.match(
    formatMarkdownReport(comparison),
    /JSHeapUsedSize was not reported by the `base` trace/,
  );
});

test("drops the sign from a change that rounds to zero", () => {
  const summary = traceSummary();
  summary.summary[1].meanMetrics.LayoutDuration = 0.0099;

  assert.match(
    formatMarkdownReport(compareSummaries(summary)),
    /\| LayoutDuration \| 0\.010s \| 0\.010s \| 0\.000s \(within noise\) \|/,
  );
});
