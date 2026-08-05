// ABOUTME: Loads the local data used to build one walking-record period.
// ABOUTME: Reports progress as each real data and trace step completes.

import browser from "webextension-polyfill";
import type { CollectionEvent } from "../collectors/types";
import type {
  ScreenTimeSession,
  WalkingRecordTrace,
} from "../storage/LocalEventStore";
import {
  attachWalkingRecordTraces,
  deriveWalkingRecord,
  getWalkingRecordTraceTargets,
  type WalkingRecord,
  type WalkingRecordDomain,
  type WalkingRecordPeriod,
  type WalkingRecordRange,
} from "./walkingRecord";

export interface WalkingRecordLoadProgress {
  completed: number;
  total: number;
  message: string;
}

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

const LOAD_STEP_COUNT = 5;

export async function loadWalkingRecord(
  period: WalkingRecordPeriod,
  range: WalkingRecordRange,
  baseColor: string,
  onProgress: (progress: WalkingRecordLoadProgress) => void,
): Promise<WalkingRecord> {
  let completedDataSteps = 0;
  const trackDataRequest = async <Response>(
    request: Promise<Response>,
    message: string,
  ): Promise<Response> => {
    const response = await request;
    completedDataSteps += 1;
    onProgress({
      completed: completedDataSteps,
      total: LOAD_STEP_COUNT,
      message,
    });
    return response;
  };

  const [eventsResponse, screenTimeResponse, domainsResponse] =
    (await Promise.all([
      trackDataRequest(
        browser.runtime.sendMessage({
          type: "GET_WALKING_RECORD_EVENTS",
          options: {
            startTs: range.startTs,
            endTs: range.endTs,
          },
        }),
        "gathering movement traces…",
      ),
      trackDataRequest(
        browser.runtime.sendMessage({
          type: "GET_SCREEN_TIME",
          options: {
            startTs: range.startTs,
            endTs: range.endTs,
          },
        }),
        "counting browsing time…",
      ),
      trackDataRequest(
        browser.runtime.sendMessage({ type: "GET_ALL_DOMAINS" }),
        "finding familiar places…",
      ),
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

  onProgress({
    completed: 4,
    total: LOAD_STEP_COUNT,
    message: `arranging this ${period}’s record…`,
  });
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
  if (targets.length === 0) {
    onProgress({
      completed: LOAD_STEP_COUNT,
      total: LOAD_STEP_COUNT,
      message: `finishing this ${period}’s record…`,
    });
    return record;
  }

  const tracesResponse = (await browser.runtime.sendMessage({
    type: "GET_WALKING_RECORD_TRACES",
    targets,
  })) as TracesResponse;
  if (!tracesResponse.success || !tracesResponse.traces) {
    onProgress({
      completed: LOAD_STEP_COUNT,
      total: LOAD_STEP_COUNT,
      message: `finishing this ${period}’s record…`,
    });
    return record;
  }

  onProgress({
    completed: LOAD_STEP_COUNT,
    total: LOAD_STEP_COUNT,
    message: "restoring cursor trails…",
  });
  return attachWalkingRecordTraces(record, tracesResponse.traces);
}
