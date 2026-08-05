// ABOUTME: Tests extension performance comparison thresholds and report text.
// ABOUTME: Keeps the report-only workflow behavior stable without launching a browser.

import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSummaries,
  formatMarkdownReport,
} from "./compare-extension-performance.mjs";

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
          JSHeapUsedSize: 10 * 1024 * 1024,
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
          JSHeapUsedSize: 17 * 1024 * 1024,
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
    comparison.metrics.find((metric) => metric.name === "ScriptDuration").status,
    "ok",
  );
  assert.equal(
    comparison.metrics.find((metric) => metric.name === "LayoutDuration").status,
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
  assert.match(markdown, /Report-only/);
  assert.match(
    markdown,
    /\| TaskDuration \| 1\.000s \| 1\.400s \| \+40\.0% \(\+0\.400s\) \| flagged \|/,
  );
  assert.match(
    markdown,
    /\| JSHeapUsedSize \| 10\.00 MB \| 17\.00 MB \| \+70\.0% \(\+7\.00 MB\) \| flagged \|/,
  );
  assert.match(markdown, /FunctionCall/);
});
