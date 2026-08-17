// ABOUTME: Mounts the walking record as both a standalone extension page and the new-tab override.
// ABOUTME: Loads navigable calendar week, month, or year records without network requests.

import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/lora/latin-400.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-500.css";
import "@fontsource/lora/latin-600.css";
import "@fontsource/martian-mono/latin-300.css";
import "@fontsource/martian-mono/latin-400.css";
import "@fontsource/martian-mono/latin-500.css";
import "@fontsource/martian-mono/latin-600.css";
import "@fontsource/source-serif-4/latin-200-italic.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import { WalkingRecordPage } from "../../components/WalkingRecord";
import {
  getWalkingRecordPeriodRange,
  summarizeWalkingRecordPeriods,
  type WalkingRecord,
  type WalkingRecordPeriod,
  type WalkingRecordPeriodSummary,
} from "../../history/walkingRecord";
import {
  loadWalkingRecord,
  WALKING_RECORD_LOAD_STEP_COUNT,
  type WalkingRecordLoadProgress,
} from "../../history/loadWalkingRecord";
import {
  readWalkingRecordCache,
  walkingRecordCacheKey,
  writeWalkingRecordCache,
} from "../../history/walkingRecordCache";
import type { ScreenTimeSession } from "../../storage/LocalEventStore";
import { getPublicPlayerIdentity } from "../../storage/playerIdentity";

const DEFAULT_CURSOR_COLOR = "#4a9a8a";
const PERIOD_RAIL_COUNT = 12;
const EARLIEST_PERIOD_OFFSET = 1 - PERIOD_RAIL_COUNT;

interface ScreenTimeResponse {
  success?: boolean;
  sessions?: ScreenTimeSession[];
}

function NewTabPage() {
  const [period, setPeriod] = useState<WalkingRecordPeriod>("week");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [records, setRecords] = useState<Record<string, WalkingRecord>>({});
  const [previewRecord, setPreviewRecord] = useState<{
    key: string;
    record: WalkingRecord;
  } | null>(null);
  const [periodSummaries, setPeriodSummaries] = useState<
    Partial<Record<WalkingRecordPeriod, WalkingRecordPeriodSummary[]>>
  >({});
  const [baseColor, setBaseColor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [movementLoadingKey, setMovementLoadingKey] = useState<string | null>(
    null,
  );
  const [loadingProgress, setLoadingProgress] =
    useState<WalkingRecordLoadProgress>({
      completed: 0,
      total: WALKING_RECORD_LOAD_STEP_COUNT,
      message: "opening your local record…",
    });
  const [error, setError] = useState<string | null>(null);
  const range = getWalkingRecordPeriodRange(period, periodOffset);
  const recordKey = `${period}:${range.startTs}`;
  const record =
    records[recordKey] ??
    (previewRecord?.key === recordKey ? previewRecord.record : null);
  const emptyPeriodSummaries = summarizeWalkingRecordPeriods(
    period,
    [],
    PERIOD_RAIL_COUNT,
  );
  const visiblePeriodSummaries =
    periodSummaries[period] ?? emptyPeriodSummaries;

  useEffect(() => {
    getPublicPlayerIdentity()
      .then((identity) => {
        setBaseColor(
          identity?.playerStyle.colorPalette[0] ?? DEFAULT_CURSOR_COLOR,
        );
      })
      .catch((identityError: unknown) => {
        console.error(
          "[WalkingRecord] Could not load cursor identity:",
          identityError,
        );
        setBaseColor(DEFAULT_CURSOR_COLOR);
      });
  }, []);

  useEffect(() => {
    if (!baseColor) return;

    const existingRecord = records[recordKey];
    if (existingRecord) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const visiblePreview =
      previewRecord?.key === recordKey ? previewRecord.record : null;
    let baseRecordShown = Boolean(visiblePreview);
    const cacheKey = walkingRecordCacheKey(period, range, baseColor);

    const openRecord = async () => {
      let cachedRecord = null;
      try {
        cachedRecord = await readWalkingRecordCache(cacheKey);
      } catch (cacheError) {
        console.error(
          "[WalkingRecord] Could not read the recent record cache:",
          cacheError,
        );
      }
      if (cancelled) return;

      if (cachedRecord) {
        setRecords((current) => ({
          ...current,
          [recordKey]: cachedRecord.record,
        }));
        setPreviewRecord((current) =>
          current?.key === recordKey ? null : current,
        );
        setLoading(false);
        setError(null);
        if (cachedRecord.fresh) return;
      } else if (visiblePreview) {
        setLoading(false);
        setError(null);
        setMovementLoadingKey(recordKey);
      } else {
        setLoading(true);
        setLoadingProgress({
          completed: 0,
          total: WALKING_RECORD_LOAD_STEP_COUNT,
          message: `opening this ${period}’s record…`,
        });
        setError(null);
      }

      try {
        const walkingRecord = await loadWalkingRecord(
          period,
          range,
          baseColor,
          (progress) => {
            if (!cancelled && !cachedRecord && !visiblePreview) {
              setLoadingProgress(progress);
            }
          },
          (baseRecord) => {
            if (cancelled || cachedRecord || visiblePreview) return;
            baseRecordShown = true;
            setPreviewRecord({ key: recordKey, record: baseRecord });
            setLoading(false);
            setMovementLoadingKey(recordKey);
          },
        );
        if (cancelled) return;

        setRecords((current) => ({
          ...current,
          [recordKey]: walkingRecord,
        }));
        setPreviewRecord((current) =>
          current?.key === recordKey ? null : current,
        );
        setMovementLoadingKey((current) =>
          current === recordKey ? null : current,
        );
        try {
          await writeWalkingRecordCache(cacheKey, walkingRecord);
        } catch (cacheError) {
          console.error(
            "[WalkingRecord] Could not save the recent record cache:",
            cacheError,
          );
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        console.error(
          "[WalkingRecord] Could not load local activity:",
          loadError,
        );
        if (!cachedRecord && !baseRecordShown) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The local activity record is unavailable.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setMovementLoadingKey((current) =>
            current === recordKey ? null : current,
          );
        }
      }
    };

    void openRecord();

    return () => {
      cancelled = true;
    };
  }, [
    baseColor,
    period,
    range.endTs,
    range.startTs,
    recordKey,
  ]);

  useEffect(() => {
    const summaries = summarizeWalkingRecordPeriods(
      period,
      [],
      PERIOD_RAIL_COUNT,
    );
    const firstRange = summaries[0].range;
    const lastRange = summaries.at(-1)!.range;
    let cancelled = false;

    browser.runtime
      .sendMessage({
        type: "GET_SCREEN_TIME",
        options: {
          startTs: firstRange.startTs,
          endTs: lastRange.endTs,
        },
      })
      .then((response: ScreenTimeResponse) => {
        if (cancelled || !response.success || !response.sessions) return;
        const sessions = response.sessions;
        setPeriodSummaries((current) => ({
          ...current,
          [period]: summarizeWalkingRecordPeriods(
            period,
            sessions,
            PERIOD_RAIL_COUNT,
          ),
        }));
      })
      .catch((summaryError: unknown) => {
        console.error(
          "[WalkingRecord] Could not load period summaries:",
          summaryError,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  const selectPeriod = (nextPeriod: WalkingRecordPeriod) => {
    const nextRange = getWalkingRecordPeriodRange(nextPeriod);
    const nextRecordKey = `${nextPeriod}:${nextRange.startTs}`;
    const nextRecord =
      records[nextRecordKey] ??
      (previewRecord?.key === nextRecordKey ? previewRecord.record : null);
    setError(null);
    if (!nextRecord) {
      setLoadingProgress({
        completed: 0,
        total: WALKING_RECORD_LOAD_STEP_COUNT,
        message: `opening this ${nextPeriod}’s record…`,
      });
    }
    setLoading(!nextRecord);
    setPeriodOffset(0);
    setPeriod(nextPeriod);
  };

  const selectPeriodOffset = (nextOffset: number) => {
    if (nextOffset < EARLIEST_PERIOD_OFFSET || nextOffset > 0) return;

    const nextRange = getWalkingRecordPeriodRange(period, nextOffset);
    const nextRecordKey = `${period}:${nextRange.startTs}`;
    const nextRecord =
      records[nextRecordKey] ??
      (previewRecord?.key === nextRecordKey ? previewRecord.record : null);
    setError(null);
    if (!nextRecord) {
      setLoadingProgress({
        completed: 0,
        total: WALKING_RECORD_LOAD_STEP_COUNT,
        message: `opening this ${period}’s record…`,
      });
    }
    setLoading(!nextRecord);
    setPeriodOffset(nextOffset);
  };

  return (
    <WalkingRecordPage
      record={record}
      period={period}
      periodOffset={periodOffset}
      periodSummaries={visiblePeriodSummaries}
      onPeriodChange={selectPeriod}
      onPeriodOffsetChange={selectPeriodOffset}
      loading={loading}
      movementLoading={movementLoadingKey === recordKey}
      loadingProgress={loadingProgress}
      error={error}
    />
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Walking record root element is missing.");
}

createRoot(container).render(<NewTabPage />);
