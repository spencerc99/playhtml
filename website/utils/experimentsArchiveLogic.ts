// ABOUTME: Provides deterministic helpers for homepage experiment traces.
// ABOUTME: Keeps shared archive behavior testable outside React and playhtml.

export const TraceRetentionMs = 72 * 60 * 60 * 1000;

export interface ExperimentEntry {
  number: string;
  href?: string;
}

export interface ExperimentTrace {
  id: string;
  rowId: string;
  color: string;
  createdAt: number;
  x: number;
}

export function pruneExperimentTraces(
  traces: ExperimentTrace[],
  now: number,
): ExperimentTrace[] {
  return traces.filter((trace) => now - trace.createdAt <= TraceRetentionMs);
}

export function addExperimentTrace(
  traces: ExperimentTrace[],
  trace: ExperimentTrace,
  now: number,
  maxTracesPerRow = 8,
): ExperimentTrace[] {
  const indexesToRemove = getExperimentTraceIndexesToRemove(
    traces,
    trace,
    now,
    maxTracesPerRow,
  );

  return [
    ...traces.filter((_existingTrace, index) => !indexesToRemove.includes(index)),
    trace,
  ];
}

export function getExperimentTraceIndexesToRemove(
  traces: ExperimentTrace[],
  trace: ExperimentTrace,
  now: number,
  maxTracesPerRow = 8,
): number[] {
  const expiredIndexes: number[] = [];
  const rowIndexes: number[] = [];

  traces.forEach((existingTrace, index) => {
    if (now - existingTrace.createdAt > TraceRetentionMs) {
      expiredIndexes.push(index);
      return;
    }

    if (existingTrace.rowId === trace.rowId) {
      rowIndexes.push(index);
    }
  });

  const rowTracesToRemove = Math.max(
    0,
    rowIndexes.length + 1 - maxTracesPerRow,
  );

  return Array.from(
    new Set([...expiredIndexes, ...rowIndexes.slice(0, rowTracesToRemove)]),
  ).sort((a, b) => b - a);
}

export function buildRandomExperimentSequence<T extends ExperimentEntry>(
  experiments: T[],
  selectedIndex: number,
): T[] {
  if (experiments.length === 0) {
    throw new Error("Cannot randomize an empty experiment list.");
  }

  const normalizedIndex =
    ((selectedIndex % experiments.length) + experiments.length) %
    experiments.length;
  const selectedExperiment = experiments[normalizedIndex];
  const repeatedExperiments = Array.from(
    { length: experiments.length * 3 },
    (_, index) => experiments[index % experiments.length],
  );

  return [...repeatedExperiments, selectedExperiment];
}
