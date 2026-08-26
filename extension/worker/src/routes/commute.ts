// ABOUTME: Serves the privacy-limited recent route used by Internet Commute.
// ABOUTME: Reduces navigation and recent activity events before returning them to the extension.

import type { CollectionEvent } from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';
import { buildCommuteResponse } from './commutePolicy';
import { handleRecent } from './recent';

const NAVIGATION_LIMIT = 2000;
const ACTIVITY_LIMIT = 1000;

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
    const [navigationEvents, activityEvents] = await Promise.all([
      fetchRecentEvents(request, env, 'navigation', NAVIGATION_LIMIT),
      fetchRecentEvents(request, env, 'all', ACTIVITY_LIMIT),
    ]);
    const response = buildCommuteResponse(
      navigationEvents,
      activityEvents,
      Date.now(),
    );

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
