// ABOUTME: Serves the privacy-limited recent route used by Internet Commute.
// ABOUTME: Reduces navigation and recent activity events before returning them to the extension.

import type {
  CollectionEvent,
  CommuteResponse,
} from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';
import { buildCommuteResponse, getActivePeopleSince } from './commutePolicy';
import {
  applyInternetPlacePolicies,
  loadInternetPlacePolicies,
} from './internetPlaceCatalog';
import {
  checkSceneryNames,
  getReviewNeed,
  hostnameKey,
  loadClefGate,
  loadClefSuggestions,
  loadNameGate,
  loadNameVerdicts,
  suggestUnreviewedPlaces,
  type ReviewNeed,
} from './internetPlaceSuggestion';
import {
  normalizeInternetPlace,
  resolveInternetPlacePolicy,
  type InternetPlacePolicy,
} from '../../../shared/internetPlaceCatalog';
import { handleRecent, loadRecentParticipantIds } from './recent';
import { getAdminAuthError } from '../lib/adminAuth';
import { createTimedMemo } from '../lib/timedMemo';

const NAVIGATION_LIMIT = 2000;
// Counts people among the newest events of any type inside the active window.
const ACTIVE_PEOPLE_EVENT_LIMIT = 1000;
// Every open commute polls the public route; one isolate builds it at most
// once per window and shares that build with every request in between.
const COMMUTE_RESPONSE_TTL_MS = 30_000;
const COMMUTE_RESPONSE_ABANDON_LOAD_MS = 20_000;
const COMMUTE_EVENTS_BASE_URL = 'https://commute.internal/';
const REVIEW_NAVIGATION_LIMIT = 10_000;
const REVIEW_DESTINATION_LIMIT = 200;
const REVIEW_SCENERY_LIMIT = 200;
const CATALOG_CANDIDATE_LIMIT = 200;
const COMMUTE_DESTINATION_LIMIT = 50;
// Caps Clef calls per sweep. The sweep runs every 15 minutes, so this bounds
// Clef to about 1,400 page checks and 1,400 name checks a day.
const SWEEP_SUGGESTION_LIMIT = 15;

const commuteResponseMemo = createTimedMemo<CommuteResponse>({
  ttlMs: COMMUTE_RESPONSE_TTL_MS,
  abandonLoadAfterMs: COMMUTE_RESPONSE_ABANDON_LOAD_MS,
});

async function fetchRecentEvents(
  env: Env,
  type: 'navigation' | 'all',
  limit: number,
): Promise<CollectionEvent[]> {
  const url = new URL('/events/recent', COMMUTE_EVENTS_BASE_URL);
  url.searchParams.set('type', type);
  url.searchParams.set('limit', limit.toString());
  if (type === 'navigation') {
    url.searchParams.set('require_title', 'true');
  }

  const response = await handleRecent(new Request(url), env);
  if (!response.ok) {
    throw new Error(`Recent ${type} request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Recent ${type} response is malformed`);
  }
  return payload as CollectionEvent[];
}

export async function handleCommute(
  _request: Request,
  env: Env,
): Promise<Response> {
  try {
    const response = await getCommuteResponse(env);

    // Riders estimate the server clock from generatedAt, so it is stamped when
    // the response is sent rather than when the shared route was built.
    return new Response(JSON.stringify({ ...response, generatedAt: Date.now() }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[commute] recent route failed:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to build recent commute route' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}

export async function handleCommuteReview(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  try {
    const navigationEvents = await fetchRecentEvents(
      env,
      'navigation',
      REVIEW_NAVIGATION_LIMIT,
    );
    const response = buildCommuteResponse(
      navigationEvents,
      [],
      Date.now(),
      {
        destinations: REVIEW_DESTINATION_LIMIT,
        scenery: REVIEW_SCENERY_LIMIT,
      },
    );

    return new Response(JSON.stringify(await annotateReviewQueue(env, response, navigationEvents)), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[commute] review route failed:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to build commute review queue' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}

/**
 * The public, policy-checked commute route. Built at most once per isolate
 * every COMMUTE_RESPONSE_TTL_MS; concurrent callers share one build.
 */
export function getCommuteResponse(env: Env): Promise<CommuteResponse> {
  return commuteResponseMemo.get(() => buildPublicCommuteResponse(env, Date.now()));
}

/** Drops the isolate's shared commute route so the next caller rebuilds it. */
export function clearCommuteResponseMemo(): void {
  commuteResponseMemo.clear();
}

async function buildPublicCommuteResponse(
  env: Env,
  now: number,
): Promise<CommuteResponse> {
  const [navigationEvents, activeParticipantIds] = await Promise.all([
    fetchRecentEvents(env, 'navigation', NAVIGATION_LIMIT),
    loadRecentParticipantIds(env, getActivePeopleSince(now), ACTIVE_PEOPLE_EVENT_LIMIT),
  ]);
  const candidates = buildCommuteResponse(navigationEvents, activeParticipantIds, now, {
    destinations: CATALOG_CANDIDATE_LIMIT,
  });
  const policies = await loadInternetPlacePolicies(env.WWO_ADMIN_DB, candidates);
  // Without the AI binding (local dev) nothing could ever approve a page, so
  // the gate only applies where Clef runs.
  const gate = env.AI
    ? [
        ...(await loadClefGate(
          env.WWO_ADMIN_DB,
          unreviewedDestinations(candidates, policies).map(({ url }) => url),
        )),
        ...(await loadNameGate(env.WWO_ADMIN_DB, unreviewedSceneryNames(candidates, policies))),
      ]
    : [];
  return applyInternetPlacePolicies(
    candidates,
    [...policies, ...gate],
    COMMUTE_DESTINATION_LIMIT,
  );
}

/**
 * Scenery hostnames no human hostname or site policy covers. Page and path
 * policies never apply to scenery, so they don't count as a review here.
 */
function unreviewedSceneryNames(
  response: CommuteResponse,
  policies: InternetPlacePolicy[],
): string[] {
  const decided = policies.filter(
    (policy) => policy.placement && (policy.scope === 'hostname' || policy.scope === 'site'),
  );
  return response.scenery
    .map(({ domain }) => domain)
    .filter((domain) => !resolveInternetPlacePolicy(decided, `https://${domain}/`));
}

/** Destinations no human policy covers at any scope. */
function unreviewedDestinations(
  response: CommuteResponse,
  policies: InternetPlacePolicy[],
): CommuteResponse['destinations'] {
  const decided = policies.filter((policy) => policy.placement);
  return response.destinations.filter(
    (destination) => !resolveInternetPlacePolicy(decided, destination.url),
  );
}

/**
 * Scheduled sweep: asks Clef about the commute's live candidates that it has
 * not judged yet, so the gate can let approved pages through. Only pages that
 * could appear in a commute are asked about; most visited pages never do.
 */
export async function suggestCommuteDestinations(
  env: Env,
  now = Date.now(),
): Promise<number> {
  const navigationEvents = await fetchRecentEvents(
    env,
    'navigation',
    NAVIGATION_LIMIT,
  );
  const candidates = buildCommuteResponse(navigationEvents, [], now, {
    destinations: CATALOG_CANDIDATE_LIMIT,
  });
  const policies = await loadInternetPlacePolicies(env.WWO_ADMIN_DB, candidates);
  const [pages, names] = await Promise.all([
    suggestUnreviewedPlaces(
      env,
      unreviewedDestinations(candidates, policies),
      SWEEP_SUGGESTION_LIMIT,
    ),
    checkSceneryNames(env, unreviewedSceneryNames(candidates, policies), SWEEP_SUGGESTION_LIMIT),
  ]);
  return pages + names;
}

type ReviewAnnotation = {
  need: ReviewNeed | null;
  visits: number;
  clef?: { placement: string; confidence: number };
};

function pageKeyOf(url: string): string | null {
  try {
    return normalizeInternetPlace(url, 'page');
  } catch {
    return null;
  }
}

/**
 * Tells the desk why each undecided page still needs a human, using Clef's
 * cached answer, and puts the most-visited pages first.
 */
async function annotateReviewQueue(
  env: Env,
  response: CommuteResponse,
  navigationEvents: CollectionEvent[],
): Promise<CommuteResponse & {
  destinations: Array<CommuteResponse['destinations'][number] & {
    review: ReviewAnnotation;
  }>;
  scenery: Array<CommuteResponse['scenery'][number] & { review: ReviewAnnotation }>;
}> {
  const visits = new Map<string, number>();
  for (const event of navigationEvents) {
    const key = event.meta?.url ? pageKeyOf(event.meta.url) : null;
    if (key) visits.set(key, (visits.get(key) ?? 0) + 1);
  }
  const policies = await loadInternetPlacePolicies(env.WWO_ADMIN_DB, response);
  const undecided = new Set(
    unreviewedDestinations(response, policies).map(({ url }) => url),
  );
  const suggestions = await loadClefSuggestions(
    env.WWO_ADMIN_DB,
    response.destinations.map(({ url }) => url),
  );
  const destinations = response.destinations.map((destination) => {
    const key = pageKeyOf(destination.url);
    const suggestion = key ? suggestions.get(key) : undefined;
    return {
      ...destination,
      review: {
        need: undecided.has(destination.url) ? getReviewNeed(suggestion) : null,
        visits: key ? visits.get(key) ?? 1 : 1,
        ...(suggestion
          ? { clef: { placement: suggestion.placement, confidence: suggestion.confidence } }
          : {}),
      },
    };
  });
  destinations.sort((first, second) => second.review.visits - first.review.visits);
  const undecidedNames = new Set(unreviewedSceneryNames(response, policies));
  const nameVerdicts = await loadNameVerdicts(
    env.WWO_ADMIN_DB,
    response.scenery.map(({ domain }) => domain),
  );
  const scenery = response.scenery.map((item) => {
    const key = hostnameKey(item.domain);
    const verdict = key ? nameVerdicts.get(key) : undefined;
    const hidden = undecidedNames.has(item.domain) && verdict?.placement === 'hidden';
    return {
      ...item,
      review: {
        need: hidden ? ('hidden' as const) : null,
        visits: 1,
        ...(verdict ? { clef: { placement: verdict.placement, confidence: verdict.confidence } } : {}),
      },
    };
  });
  return { ...response, destinations, scenery };
}
