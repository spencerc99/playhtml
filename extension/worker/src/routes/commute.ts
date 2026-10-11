// ABOUTME: Serves the privacy-limited recent route used by Internet Commute.
// ABOUTME: Reduces navigation and recent activity events before returning them to the extension.

import type {
  CollectionEvent,
  CommuteResponse,
} from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';
import { buildCommuteResponse } from './commutePolicy';
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
import { handleRecent } from './recent';
import { getAdminAuthError } from '../lib/adminAuth';

const NAVIGATION_LIMIT = 2000;
const ACTIVITY_LIMIT = 1000;
const REVIEW_NAVIGATION_LIMIT = 10_000;
const REVIEW_DESTINATION_LIMIT = 200;
const REVIEW_SCENERY_LIMIT = 200;
const CATALOG_CANDIDATE_LIMIT = 200;
const COMMUTE_DESTINATION_LIMIT = 50;
const SWEEP_SUGGESTION_LIMIT = 50;
// Caps Clef calls per upload so a burst of traffic can't fan out into hundreds.
const INGEST_SUGGESTION_LIMIT = 5;

async function fetchRecentEvents(
  request: Request,
  env: Env,
  type: 'navigation' | 'all',
  limit: number,
): Promise<CollectionEvent[]> {
  const url = new URL('/events/recent', request.url);
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
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const response = await getCommuteResponse(request, env, Date.now());

    return new Response(JSON.stringify(response), {
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
      request,
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

export async function getCommuteResponse(
  request: Request,
  env: Env,
  now: number,
): Promise<CommuteResponse> {
  const [navigationEvents, activityEvents] = await Promise.all([
    fetchRecentEvents(request, env, 'navigation', NAVIGATION_LIMIT),
    fetchRecentEvents(request, env, 'all', ACTIVITY_LIMIT),
  ]);
  const candidates = buildCommuteResponse(navigationEvents, activityEvents, now, {
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

/** Scenery hostnames no human policy covers. */
function unreviewedSceneryNames(
  response: CommuteResponse,
  policies: InternetPlacePolicy[],
): string[] {
  const decided = policies.filter((policy) => policy.placement);
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
 * Scheduled backup sweep: asks Clef about live destinations that ingest
 * missed or that failed, so the gate can let approved pages through.
 */
export async function suggestCommuteDestinations(
  env: Env,
  now = Date.now(),
): Promise<number> {
  const request = new Request('https://commute.internal/');
  const navigationEvents = await fetchRecentEvents(
    request,
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

/**
 * Asks Clef about the destinations in a freshly ingested batch, so a new page
 * is usually approved or held within seconds of the visit instead of waiting
 * for the scheduled sweep.
 */
export async function suggestIngestedDestinations(
  env: Env,
  events: CollectionEvent[],
  now = Date.now(),
): Promise<number> {
  if (!env.AI) return 0;
  const navigationEvents = events.filter((event) => event.type === 'navigation');
  if (navigationEvents.length === 0) return 0;
  const candidates = buildCommuteResponse(navigationEvents, [], now, {
    destinations: CATALOG_CANDIDATE_LIMIT,
  });
  if (candidates.destinations.length === 0 && candidates.scenery.length === 0) return 0;
  const policies = await loadInternetPlacePolicies(env.WWO_ADMIN_DB, candidates);
  const [pages, names] = await Promise.all([
    suggestUnreviewedPlaces(
      env,
      unreviewedDestinations(candidates, policies),
      INGEST_SUGGESTION_LIMIT,
    ),
    checkSceneryNames(env, unreviewedSceneryNames(candidates, policies), INGEST_SUGGESTION_LIMIT),
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
