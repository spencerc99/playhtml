// ABOUTME: Tests playhtml library benchmark comparison thresholds and report text.
// ABOUTME: Runs without building the library or launching the benchmark.

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareResults,
  formatMarkdownReport,
} from "./compare-library-performance.mjs";

const base = {
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
    /\| Remote update: renders \| 100 \| 200 \| \+100\.0% \(\+100\) \|/,
  );
});

test("small bundle growth under the absolute threshold is not flagged", () => {
  const comparison = compareResults(
    { bundle_gz_kb: 10 },
    { bundle_gz_kb: 10.4 },
  );
  assert.equal(statusOf(comparison, "bundle_gz_kb"), "ok");
});

test("metrics missing from one side are reported, not flagged", () => {
  const comparison = compareResults(
    { ...base, init_qsa_calls: undefined },
    base,
  );
  assert.equal(statusOf(comparison, "init_qsa_calls"), "missing");
  assert.equal(comparison.regressions.length, 0);
});
