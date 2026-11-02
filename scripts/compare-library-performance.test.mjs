// ABOUTME: Tests playhtml library benchmark comparison thresholds and report text.
// ABOUTME: Runs without building the library or launching the benchmark.

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareResults,
  failureCount,
  formatMarkdownReport,
  METRICS,
} from "./compare-library-performance.mjs";

const base = {
  ...Object.fromEntries(METRICS.map((metric) => [metric.key, 100])),
  bundle_gz_kb: 65.2,
  bundle_raw_kb: 217.6,
  stream_msgs: 193,
  stream_bytes: 17811,
  stream_doc_growth: 10690,
  append_bytes: 2022,
  append_doc_growth: 792,
  edit_bytes: 1928,
  edit_doc_growth: 1200,
  fanout_renders: 100,
  init_qsa_calls: 26,
};

function statusOf(comparison, key) {
  return comparison.metrics.find((metric) => metric.key === key).status;
}

test("identical results flag nothing", () => {
  const comparison = compareResults(base, { ...base });
  assert.equal(comparison.regressions.length, 0);
  assert.match(formatMarkdownReport(comparison), /no regressions flagged/);
});

test("flags increases past both the relative and absolute threshold", () => {
  const comparison = compareResults(
    base,
    {
      ...base,
      bundle_gz_kb: 67.0, // +2.8%, +1.8 KB
      stream_bytes: 17900, // +0.5%, under 10%
      fanout_renders: 200, // +100%
      init_qsa_calls: 20, // fewer scans
    },
    { failOnRegression: true },
  );

  assert.equal(statusOf(comparison, "bundle_gz_kb"), "regression");
  assert.equal(statusOf(comparison, "stream_bytes"), "ok");
  assert.equal(statusOf(comparison, "fanout_renders"), "regression");
  assert.equal(statusOf(comparison, "init_qsa_calls"), "improved");

  const markdown = formatMarkdownReport(comparison);
  assert.match(markdown, /<!-- library-performance-report -->/);
  assert.match(markdown, /2 metrics flagged\. This check fails/);
  assert.match(
    markdown,
    /\| 100 remote updates: updateElement calls \| 100 \| 200 \| \+100\.0% \(\+100\) \|/,
  );
});

test("small bundle growth under the absolute threshold is not flagged", () => {
  const comparison = compareResults(
    { bundle_gz_kb: 10 },
    { bundle_gz_kb: 10.4 },
  );
  assert.equal(statusOf(comparison, "bundle_gz_kb"), "ok");
});

test("a metric the PR stops reporting fails the check", () => {
  const comparison = compareResults(
    base,
    { ...base, init_qsa_calls: undefined, fanout_renders: Number.NaN },
    { failOnRegression: true },
  );
  assert.equal(statusOf(comparison, "init_qsa_calls"), "missing");
  assert.equal(statusOf(comparison, "fanout_renders"), "missing");
  assert.equal(failureCount(comparison), 2);
  assert.match(
    formatMarkdownReport(comparison),
    /no longer reports `fanout_renders`, `init_qsa_calls`\. This check fails/,
  );
});

test("a metric new in the PR passes", () => {
  const comparison = compareResults(
    { ...base, init_qsa_calls: undefined },
    base,
  );
  assert.equal(statusOf(comparison, "init_qsa_calls"), "new");
  assert.equal(failureCount(comparison), 0);
});

test("timings are shown but never flagged or required", () => {
  const comparison = compareResults(
    { ...base, init_1000_ms: 100 },
    { ...base, init_1000_ms: 500, react_mount_50_ms: undefined },
    { failOnRegression: true },
  );
  assert.equal(statusOf(comparison, "init_1000_ms"), "info");
  assert.equal(statusOf(comparison, "react_mount_50_ms"), "new");
  assert.equal(failureCount(comparison), 0);
  assert.match(
    formatMarkdownReport(comparison),
    /\| 500\.0 ms \| \+400\.0% \(\+400\.0 ms\) \| info only \| info \|/,
  );
});

test("a render count that used to be zero is flagged at one", () => {
  const comparison = compareResults(
    { ...base, react_remote_unrelated_renders: 0 },
    { ...base, react_remote_unrelated_renders: 1 },
  );
  assert.equal(
    statusOf(comparison, "react_remote_unrelated_renders"),
    "regression",
  );
});
