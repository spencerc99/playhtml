// ABOUTME: Loads the local data used to build one walking-record period.
// ABOUTME: Reports progress as each real data and trace step completes.

import browser from "webextension-polyfill";
import type { CollectionEvent } from "../collectors/types";
import type {
  ScreenTimeSession,
  WalkingRecordActivity,
  WalkingRecordTrace,
} from "../storage/LocalEventStore";
import {
  attachWalkingRecordFavicons,
  attachWalkingRecordLandscape,
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
  error?: string;
  events?: CollectionEvent[];
  cursorDistancePx?: number;
  activity?: WalkingRecordActivity[];
  sessions?: ScreenTimeSession[];
}

interface DomainsResponse {
  success?: boolean;
  error?: string;
  domains?: WalkingRecordDomain[];
}

interface MovementResponse {
  success?: boolean;
  traces?: WalkingRecordTrace[];
  landscapePaths?: CollectionEvent[][];
}

export const WALKING_RECORD_LOAD_STEP_COUNT = 4;

let domainsRequest: Promise<DomainsResponse> | null = null;

function getWalkingRecordDomains(): Promise<DomainsResponse> {
  if (!domainsRequest) {
    domainsRequest = browser.runtime
      .sendMessage({ type: "GET_ALL_DOMAINS" })
      .then((response) => {
        const domainsResponse = response as DomainsResponse;
        if (!domainsResponse.success) domainsRequest = null;
        return domainsResponse;
      })
      .catch((error) => {
        domainsRequest = null;
        throw error;
      });
  }
  return domainsRequest;
}

export async function loadWalkingRecord(
  period: WalkingRecordPeriod,
  range: WalkingRecordRange,
  baseColor: string,
  onProgress: (progress: WalkingRecordLoadProgress) => void,
  onBaseRecord?: (record: WalkingRecord) => void,
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
      total: WALKING_RECORD_LOAD_STEP_COUNT,
      message,
    });
    return response;
  };

  const [eventsResponse, domainsResponse] = (await Promise.all([
    trackDataRequest(
      browser.runtime.sendMessage({
        type: "GET_WALKING_RECORD_EVENTS",
        options: {
          startTs: range.startTs,
          endTs: range.endTs,
        },
      }),
      "gathering browsing activity…",
    ),
    trackDataRequest(getWalkingRecordDomains(), "mapping familiar roads…"),
  ])) as [EventsResponse, DomainsResponse];

  if (
    !eventsResponse.success ||
    !eventsResponse.events ||
    !eventsResponse.sessions
  ) {
    throw new Error(
      eventsResponse.error ?? "The local activity record is unavailable.",
    );
  }
  if (!domainsResponse.success || !domainsResponse.domains) {
    throw new Error(
      domainsResponse.error ?? "The local place record is unavailable.",
    );
  }

  onProgress({
    completed: 3,
    total: WALKING_RECORD_LOAD_STEP_COUNT,
    message: `arranging this ${period}’s record…`,
  });
  const record = attachWalkingRecordFavicons(
    deriveWalkingRecord({
      period,
      baseColor,
      events: eventsResponse.events,
      activity: eventsResponse.activity ?? [],
      sessions: eventsResponse.sessions,
      domains: domainsResponse.domains,
      range,
      cursorDistancePx: eventsResponse.cursorDistancePx,
    }),
    Object.fromEntries(
      domainsResponse.domains.flatMap((domain) =>
        domain.latestFaviconUrl
          ? [[domain.domain, domain.latestFaviconUrl]]
          : [],
      ),
    ),
  );
  onBaseRecord?.(record);
  const targets = getWalkingRecordTraceTargets(record);
  if (targets.length === 0) {
    onProgress({
      completed: WALKING_RECORD_LOAD_STEP_COUNT,
      total: WALKING_RECORD_LOAD_STEP_COUNT,
      message: `finishing this ${period}’s record…`,
    });
    return record;
  }

  onProgress({
    completed: 3,
    total: WALKING_RECORD_LOAD_STEP_COUNT,
    message: "restoring cursor trails…",
  });
  const movementResponse = (await browser.runtime.sendMessage({
    type: "GET_WALKING_RECORD_MOVEMENT",
    targets,
  })) as MovementResponse;
  if (!movementResponse.success || !movementResponse.traces) {
    onProgress({
      completed: WALKING_RECORD_LOAD_STEP_COUNT,
      total: WALKING_RECORD_LOAD_STEP_COUNT,
      message: `finishing this ${period}’s record…`,
    });
    return record;
  }

  onProgress({
    completed: WALKING_RECORD_LOAD_STEP_COUNT,
    total: WALKING_RECORD_LOAD_STEP_COUNT,
    message: `finishing this ${period}’s record…`,
  });
  return attachWalkingRecordLandscape(
    attachWalkingRecordTraces(record, movementResponse.traces),
    movementResponse.landscapePaths ?? [],
  );
}
