// ABOUTME: Verifies the walking-record entrypoint retries interrupted stale-cache refreshes.
// ABOUTME: Covers navigation away from and back to a record while refresh work is pending.

import type React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WalkingRecord,
  WalkingRecordPeriod,
} from "../history/walkingRecord";

interface WalkingRecordPageTestProps {
  record: WalkingRecord | null;
  period: WalkingRecordPeriod;
  onPeriodChange: (period: WalkingRecordPeriod) => void;
}

const mocks = vi.hoisted(() => ({
  loadWalkingRecord: vi.fn(),
  readWalkingRecordCache: vi.fn(),
  writeWalkingRecordCache: vi.fn(),
}));

vi.mock("../components/WalkingRecord", async () => {
  const ReactModule = await import("react");
  return {
    WalkingRecordPage: ({
      record,
      period,
      onPeriodChange,
    }: WalkingRecordPageTestProps) =>
      ReactModule.createElement(
        "div",
        null,
        ReactModule.createElement(
          "button",
          { onClick: () => onPeriodChange("week") },
          "week",
        ),
        ReactModule.createElement(
          "button",
          { onClick: () => onPeriodChange("month") },
          "month",
        ),
        ReactModule.createElement("span", null, period),
        ReactModule.createElement("span", null, record?.rangeLabel ?? "empty"),
      ),
  };
});

vi.mock("../storage/playerIdentity", () => ({
  getPublicPlayerIdentity: vi.fn().mockResolvedValue(null),
}));

vi.mock("../history/loadWalkingRecord", () => ({
  loadWalkingRecord: mocks.loadWalkingRecord,
  WALKING_RECORD_LOAD_STEP_COUNT: 5,
}));

vi.mock("../history/walkingRecordCache", () => ({
  readWalkingRecordCache: mocks.readWalkingRecordCache,
  walkingRecordCacheKey: (period: WalkingRecordPeriod) => period,
  writeWalkingRecordCache: mocks.writeWalkingRecordCache,
}));

const staleRecord: WalkingRecord = {
  period: "week",
  range: { startTs: 1_000, endTs: 2_000 },
  rangeLabel: "stale week",
  totalTimeMs: 60_000,
  totalTimeLabel: "1 min",
  cursorDistancePx: 100,
  pageCount: 1,
  hourBuckets: new Array(24).fill(0),
  movementCount: 0,
  departures: [],
  settledPlaces: [],
  dayPlates: [],
  landscapePaths: [],
  timeSpent: [],
};

function clickPeriod(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label} period button.`);
  button.click();
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("walking record entrypoint", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    mocks.loadWalkingRecord.mockReset();
    mocks.loadWalkingRecord.mockImplementation(
      () => new Promise<WalkingRecord>(() => {}),
    );
    mocks.readWalkingRecordCache.mockReset();
    mocks.readWalkingRecordCache.mockImplementation(async (key: string) =>
      key === "week"
        ? { record: staleRecord, fresh: false }
        : null,
    );
    mocks.writeWalkingRecordCache.mockReset();
  });

  it("retries a stale refresh after navigating away and back", async () => {
    await act(async () => {
      await import("../entrypoints/walking-record/walking-record");
      await flushEffects();
    });

    expect(document.body.textContent).toContain("stale week");
    expect(mocks.loadWalkingRecord.mock.calls.map((call) => call[0])).toEqual([
      "week",
    ]);

    await act(async () => {
      clickPeriod("month");
      await flushEffects();
    });
    await act(async () => {
      clickPeriod("week");
      await flushEffects();
    });

    expect(mocks.loadWalkingRecord.mock.calls.map((call) => call[0])).toEqual([
      "week",
      "month",
      "week",
    ]);
  });
});
