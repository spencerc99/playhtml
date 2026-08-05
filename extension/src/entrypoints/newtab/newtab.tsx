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
  attachWalkingRecordTraces,
  deriveWalkingRecord,
  getWalkingRecordPeriodRange,
  getWalkingRecordTraceTargets,
  summarizeWalkingRecordPeriods,
  type WalkingRecord,
  type WalkingRecordRange,
  type WalkingRecordDomain,
  type WalkingRecordPeriod,
  type WalkingRecordPeriodSummary,
} from "../../history/walkingRecord";
import type { CollectionEvent } from "../../collectors/types";
import type {
  ScreenTimeSession,
  WalkingRecordTrace,
} from "../../storage/LocalEventStore";
import { getPublicPlayerIdentity } from "../../storage/playerIdentity";

const DEFAULT_CURSOR_COLOR = "#4a9a8a";
const PERIOD_RAIL_COUNT = 12;
const EARLIEST_PERIOD_OFFSET = 1 - PERIOD_RAIL_COUNT;

interface EventsResponse {
  success?: boolean;
  events?: CollectionEvent[];
  cursorDistancePx?: number;
}

interface ScreenTimeResponse {
  success?: boolean;
  sessions?: ScreenTimeSession[];
}

interface DomainsResponse {
  success?: boolean;
  domains?: WalkingRecordDomain[];
}

interface TracesResponse {
  success?: boolean;
  traces?: WalkingRecordTrace[];
}

async function loadWalkingRecord(
  period: WalkingRecordPeriod,
  range: WalkingRecordRange,
  baseColor: string,
): Promise<WalkingRecord> {
  const [eventsResponse, screenTimeResponse, domainsResponse] =
    (await Promise.all([
      browser.runtime.sendMessage({
        type: "GET_WALKING_RECORD_EVENTS",
        options: {
          startTs: range.startTs,
          endTs: range.endTs,
        },
      }),
      browser.runtime.sendMessage({
        type: "GET_SCREEN_TIME",
        options: {
          startTs: range.startTs,
          endTs: range.endTs,
        },
      }),
      browser.runtime.sendMessage({ type: "GET_ALL_DOMAINS" }),
    ])) as [EventsResponse, ScreenTimeResponse, DomainsResponse];

  if (!eventsResponse.success || !eventsResponse.events) {
    throw new Error("The local activity record is unavailable.");
  }
  if (!screenTimeResponse.success || !screenTimeResponse.sessions) {
    throw new Error("The local screen-time record is unavailable.");
  }
  if (!domainsResponse.success || !domainsResponse.domains) {
    throw new Error("The local place record is unavailable.");
  }

  const record = deriveWalkingRecord({
    period,
    baseColor,
    events: eventsResponse.events,
    sessions: screenTimeResponse.sessions,
    domains: domainsResponse.domains,
    range,
    cursorDistancePx: eventsResponse.cursorDistancePx,
  });
  const targets = getWalkingRecordTraceTargets(record);
  if (targets.length === 0) return record;

  const tracesResponse = (await browser.runtime.sendMessage({
    type: "GET_WALKING_RECORD_TRACES",
    targets,
  })) as TracesResponse;
  if (!tracesResponse.success || !tracesResponse.traces) return record;

  return attachWalkingRecordTraces(record, tracesResponse.traces);
}

function NewTabPage() {
  const [period, setPeriod] = useState<WalkingRecordPeriod>("week");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [records, setRecords] = useState<Record<string, WalkingRecord>>({});
  const [periodSummaries, setPeriodSummaries] = useState<
    Partial<Record<WalkingRecordPeriod, WalkingRecordPeriodSummary[]>>
  >({});
  const [baseColor, setBaseColor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = getWalkingRecordPeriodRange(period, periodOffset);
  const recordKey = `${period}:${range.startTs}`;
  const record = records[recordKey] ?? null;
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
    if (!baseColor || record) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    loadWalkingRecord(period, range, baseColor)
      .then((walkingRecord) => {
        if (cancelled) return;
        setRecords((current) => ({
          ...current,
          [recordKey]: walkingRecord,
        }));
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        console.error(
          "[WalkingRecord] Could not load local activity:",
          loadError,
        );
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The local activity record is unavailable.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    baseColor,
    period,
    range.endTs,
    range.startTs,
    record,
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
        setPeriodSummaries((current) => ({
          ...current,
          [period]: summarizeWalkingRecordPeriods(
            period,
            response.sessions,
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
    setError(null);
    setLoading(!records[nextRecordKey]);
    setPeriodOffset(0);
    setPeriod(nextPeriod);
  };

  const selectPeriodOffset = (nextOffset: number) => {
    if (nextOffset < EARLIEST_PERIOD_OFFSET || nextOffset > 0) return;

    const nextRange = getWalkingRecordPeriodRange(period, nextOffset);
    setError(null);
    setLoading(!records[`${period}:${nextRange.startTs}`]);
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
      error={error}
    />
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Walking record root element is missing.");
}

createRoot(container).render(<NewTabPage />);
