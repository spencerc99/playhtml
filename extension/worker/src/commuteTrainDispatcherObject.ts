// ABOUTME: Persists the singleton Internet Commute dispatcher in a Durable Object.
// ABOUTME: Loads communal routes only when a new bounded train must be created.

import type {
  CommuteDestination,
  CommuteTrainAssignment,
  CommuteTrainBoardRequest,
  CommuteTrainCommunalStop,
} from '@playhtml/extension-types';
import type { Env } from './lib/supabase';
import { getCommuteResponse } from './routes/commute';
import {
  CommuteTrainDispatcher,
  CommuteTrainCapacityError,
  EMPTY_COMMUTE_TRAIN_DISPATCHER_STATE,
  type CommuteTrainDispatcherState,
} from './commuteTrainDispatcher';
import { parseCommuteTrainBoardRequest } from './routes/commuteTrains';

const DISPATCHER_STATE_KEY = 'dispatcher';

const FALLBACK_COMMUNAL_STOPS: CommuteTrainCommunalStop[] = [
  {
    kind: 'communal',
    id: 'html-energy',
    domain: 'html.energy',
    url: 'https://html.energy/',
    title: null,
    visitedAt: 0,
    hue: '#d4b85c',
  },
  {
    kind: 'communal',
    id: 'special-fish',
    domain: 'special.fish',
    url: 'https://special.fish/',
    title: null,
    visitedAt: 0,
    hue: '#5b8db8',
  },
];

export function selectCommuteTrainCommunalStops(
  destinations: CommuteDestination[],
  recentDomains: Set<string>,
  now: number,
): CommuteTrainCommunalStop[] {
  const stops: CommuteTrainCommunalStop[] = [];
  const selectedDomains = new Set<string>();
  for (const destination of destinations) {
    if (
      recentDomains.has(destination.domain) ||
      selectedDomains.has(destination.domain)
    ) {
      continue;
    }
    stops.push({ kind: 'communal', ...destination });
    selectedDomains.add(destination.domain);
    if (stops.length === 2) return stops;
  }

  for (const fallback of FALLBACK_COMMUNAL_STOPS) {
    if (
      recentDomains.has(fallback.domain) ||
      selectedDomains.has(fallback.domain)
    ) {
      continue;
    }
    stops.push({ ...fallback, visitedAt: now });
    selectedDomains.add(fallback.domain);
    if (stops.length === 2) return stops;
  }
  return stops;
}

export class CommuteTrainDispatcherObject {
  private readonly ready: Promise<CommuteTrainDispatcher>;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.ready = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<CommuteTrainDispatcherState>(
        DISPATCHER_STATE_KEY,
      );
      return new CommuteTrainDispatcher(
        stored ?? structuredClone(EMPTY_COMMUTE_TRAIN_DISPATCHER_STATE),
        () => crypto.randomUUID(),
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/board' || request.method !== 'POST') {
      return jsonResponse(404, { error: 'Not found' });
    }

    const parsed = await readBoardRequest(request);
    if (!parsed) return jsonResponse(400, { error: 'Invalid boarding request' });

    let now = Date.now();
    const dispatcher = await this.ready;
    let assignment: CommuteTrainAssignment;
    try {
      let destinations: CommuteDestination[] = [];
      if (dispatcher.needsCommunalStops(parsed.riderToken, now)) {
        destinations = await this.loadCommunalDestinations(now);
        now = Date.now();
      }

      let communalStops: CommuteTrainCommunalStop[] = [];
      if (dispatcher.needsCommunalStops(parsed.riderToken, now)) {
        communalStops = selectCommuteTrainCommunalStops(
          destinations,
          dispatcher.getRecentCommunalDomains(now),
          now,
        );
        if (communalStops.length < 2) {
          throw new Error('Internet Commute requires two unseen communal stops');
        }
      }
      assignment = dispatcher.board(parsed, communalStops, now);
    } catch (error) {
      if (!(error instanceof CommuteTrainCapacityError)) throw error;
      await this.state.storage.put(DISPATCHER_STATE_KEY, dispatcher.snapshot());
      await this.scheduleCleanup(dispatcher);
      return jsonResponse(429, { error: 'Train dispatcher is at capacity' });
    }

    await this.state.storage.put(DISPATCHER_STATE_KEY, dispatcher.snapshot());
    await this.scheduleCleanup(dispatcher);
    return jsonResponse(200, assignment);
  }

  async alarm(): Promise<void> {
    const dispatcher = await this.ready;
    dispatcher.cleanup(Date.now());
    await this.state.storage.put(DISPATCHER_STATE_KEY, dispatcher.snapshot());
    await this.scheduleCleanup(dispatcher);
  }

  private async loadCommunalDestinations(
    now: number,
  ): Promise<CommuteDestination[]> {
    let destinations: CommuteDestination[] = [];
    try {
      const response = await getCommuteResponse(
        new Request('https://dispatcher.internal/commute/recent'),
        this.env,
        now,
      );
      destinations = response.destinations;
    } catch (error) {
      console.warn('[commute trains] communal route unavailable:', error);
    }

    return destinations;
  }

  private async scheduleCleanup(
    dispatcher: CommuteTrainDispatcher,
  ): Promise<void> {
    const cleanupAt = dispatcher.nextCleanupAt();
    if (cleanupAt === null) {
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(cleanupAt);
  }
}

async function readBoardRequest(
  request: Request,
): Promise<CommuteTrainBoardRequest | null> {
  try {
    return parseCommuteTrainBoardRequest(await request.json());
  } catch {
    return null;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
