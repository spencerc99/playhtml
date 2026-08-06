// ABOUTME: Loads the local data used to build one walking-record period.
// ABOUTME: Reports progress as each real data and trace step completes.

import browser from "webextension-polyfill";
import type { CollectionEvent } from "../collectors/types";
import type {
  AggregateDay,
  ScreenTimeSession,
  WalkingRecordActivity,
  WalkingRecordTrace,
} from "../storage/LocalEventStore";
import {
  attachWalkingRecordFavicons,
  attachWalkingRecordLandscape,
  attachWalkingRecordTraces,
  deriveWalkingRecord,
  getWalkingRecordFaviconDomains,
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
}

interface ScreenTimeResponse {
  success?: boolean;
  error?: string;
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
  favicons?: Record<string, string>;
}

interface DomainDaysResponse {
  success?: boolean;
  error?: string;
  days?: AggregateDay[];
}

export const WALKING_RECORD_LOAD_STEP_COUNT = 6;

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
      total: WALKING_RECORD_LOAD_STEP_COUNT,
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
    throw new Error(
      eventsResponse.error ?? "The local activity record is unavailable.",
    );
  }
  if (!screenTimeResponse.success || !screenTimeResponse.sessions) {
    throw new Error(
      screenTimeResponse.error ?? "The local screen-time record is unavailable.",
    );
  }
  if (!domainsResponse.success || !domainsResponse.domains) {
    throw new Error(
      domainsResponse.error ?? "The local place record is unavailable.",
    );
  }

  const familiarDomains = domainsResponse.domains
    .filter((domain) => domain.activeDayCount >= 5)
    .map((domain) => domain.domain);
  const domainDaysResponse = (await browser.runtime.sendMessage({
    type: "GET_WALKING_RECORD_DOMAIN_DAYS",
    domains: familiarDomains,
  })) as DomainDaysResponse;
  if (!domainDaysResponse.success || !domainDaysResponse.days) {
    throw new Error(
      domainDaysResponse.error ??
        "The local relationship record is unavailable.",
    );
  }
  onProgress({
    completed: 4,
    total: WALKING_RECORD_LOAD_STEP_COUNT,
    message: "tracing familiar routines…",
  });

  onProgress({
    completed: 5,
    total: WALKING_RECORD_LOAD_STEP_COUNT,
    message: `arranging this ${period}’s record…`,
  });
  const record = deriveWalkingRecord({
    period,
    baseColor,
    events: eventsResponse.events,
    activity: eventsResponse.activity ?? [],
    sessions: screenTimeResponse.sessions,
    domains: domainsResponse.domains,
    domainDays: domainDaysResponse.days,
    range,
    cursorDistancePx: eventsResponse.cursorDistancePx,
  });
  const targets = getWalkingRecordTraceTargets(record);
  const faviconDomains = getWalkingRecordFaviconDomains(record);
  if (targets.length === 0 && faviconDomains.length === 0) {
    onProgress({
      completed: WALKING_RECORD_LOAD_STEP_COUNT,
      total: WALKING_RECORD_LOAD_STEP_COUNT,
      message: `finishing this ${period}’s record…`,
    });
    return record;
  }

  const movementResponse = (await browser.runtime.sendMessage({
    type: "GET_WALKING_RECORD_MOVEMENT",
    targets,
    faviconDomains,
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
    message: "restoring cursor trails…",
  });
  return attachWalkingRecordFavicons(
    attachWalkingRecordLandscape(
      attachWalkingRecordTraces(record, movementResponse.traces),
      movementResponse.landscapePaths ?? [],
    ),
    movementResponse.favicons ?? {},
  );
}
