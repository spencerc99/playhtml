// ABOUTME: Tests deterministic helpers for homepage experiment traces.
// ABOUTME: Verifies trace pruning and randomizer sequencing without browser state.

import { describe, expect, test } from "bun:test";
import {
  TraceRetentionMs,
  addExperimentTrace,
  buildRandomExperimentSequence,
  getExperimentTraceIndexesToRemove,
  pruneExperimentTraces,
  type ExperimentEntry,
  type ExperimentTrace,
} from "../utils/experimentsArchiveLogic";

const now = 2_000_000_000;

const experiments: ExperimentEntry[] = [
  { number: "EX-01", href: "/one/" },
  { number: "EX-02", href: "/two/" },
  { number: "EX-03", href: "/three/" },
];

describe("pruneExperimentTraces", () => {
  test("removes traces older than the retention window", () => {
    const traces: ExperimentTrace[] = [
      {
        id: "fresh",
        rowId: "EX-01",
        color: "#19ce2b",
        createdAt: now - 10_000,
        x: 0.2,
      },
      {
        id: "expired",
        rowId: "EX-02",
        color: "#1263cf",
        createdAt: now - TraceRetentionMs - 1,
        x: 0.7,
      },
    ];

    expect(pruneExperimentTraces(traces, now)).toEqual([traces[0]]);
  });

  test("keeps traces exactly at the retention boundary", () => {
    const boundaryTrace: ExperimentTrace = {
      id: "boundary",
      rowId: "EX-01",
      color: "#19ce2b",
      createdAt: now - TraceRetentionMs,
      x: 0.5,
    };

    expect(pruneExperimentTraces([boundaryTrace], now)).toEqual([
      boundaryTrace,
    ]);
  });
});

describe("addExperimentTrace", () => {
  test("adds the trace, prunes expired traces, and caps traces per row", () => {
    const traces: ExperimentTrace[] = [
      {
        id: "keep-1",
        rowId: "EX-01",
        color: "#19ce2b",
        createdAt: now - 40,
        x: 0.1,
      },
      {
        id: "keep-2",
        rowId: "EX-01",
        color: "#1263cf",
        createdAt: now - 30,
        x: 0.2,
      },
      {
        id: "keep-3",
        rowId: "EX-01",
        color: "#f5a90f",
        createdAt: now - 20,
        x: 0.3,
      },
      {
        id: "expired",
        rowId: "EX-02",
        color: "#d954ad",
        createdAt: now - TraceRetentionMs - 1,
        x: 0.4,
      },
    ];
    const nextTrace: ExperimentTrace = {
      id: "next",
      rowId: "EX-01",
      color: "#8a5cff",
      createdAt: now,
      x: 0.5,
    };

    expect(addExperimentTrace(traces, nextTrace, now, 3)).toEqual([
      traces[1],
      traces[2],
      nextTrace,
    ]);
  });
});

describe("getExperimentTraceIndexesToRemove", () => {
  test("selects only expired traces and overflowing traces for the target row", () => {
    const traces: ExperimentTrace[] = [
      {
        id: "target-old",
        rowId: "EX-01",
        color: "#19ce2b",
        createdAt: now - 40,
        x: 0.1,
      },
      {
        id: "other-row",
        rowId: "EX-02",
        color: "#1263cf",
        createdAt: now - 30,
        x: 0.2,
      },
      {
        id: "target-new",
        rowId: "EX-01",
        color: "#f5a90f",
        createdAt: now - 20,
        x: 0.3,
      },
      {
        id: "expired",
        rowId: "EX-03",
        color: "#d954ad",
        createdAt: now - TraceRetentionMs - 1,
        x: 0.4,
      },
    ];
    const nextTrace: ExperimentTrace = {
      id: "next",
      rowId: "EX-01",
      color: "#8a5cff",
      createdAt: now,
      x: 0.5,
    };

    expect(getExperimentTraceIndexesToRemove(traces, nextTrace, now, 2)).toEqual([
      3,
      0,
    ]);
  });
});

describe("buildRandomExperimentSequence", () => {
  test("returns only experiment entries and repeats before landing", () => {
    const sequence = buildRandomExperimentSequence(experiments, 1);

    expect(sequence.at(-1)).toEqual(experiments[1]);
    expect(sequence).toHaveLength(10);
    expect(sequence.every((entry) => entry.number.startsWith("EX-"))).toBe(
      true,
    );
  });

  test("throws when no experiments are available", () => {
    expect(() => buildRandomExperimentSequence([], 0)).toThrow(
      "Cannot randomize an empty experiment list.",
    );
  });
});
