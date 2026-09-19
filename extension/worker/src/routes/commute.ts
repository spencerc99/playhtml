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
import { handleRecent } from './recent';
import { getAdminAuthError } from '../lib/adminAuth';

const NAVIGATION_LIMIT = 2000;
const ACTIVITY_LIMIT = 1000;
const REVIEW_NAVIGATION_LIMIT = 10_000;
const REVIEW_DESTINATION_LIMIT = 200;
const REVIEW_SCENERY_LIMIT = 200;
const CATALOG_CANDIDATE_LIMIT = 200;
const COMMUTE_DESTINATION_LIMIT = 50;

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

    return new Response(JSON.stringify(response), {
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
  return applyInternetPlacePolicies(candidates, policies, COMMUTE_DESTINATION_LIMIT);
}
