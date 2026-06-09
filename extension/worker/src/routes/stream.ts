// ABOUTME: Handles GET /stream — upgrades to a WebSocket and forwards to the LiveEventsHub DO.
// ABOUTME: Public endpoint guarded by the origin allowlist; the socket is the live feed surface.

import type { Env } from '../lib/supabase';
import { HUB_NAME } from '../live/constants';

export function handleStream(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return Promise.resolve(new Response('Expected websocket', { status: 426 }));
  }
  const id = env.LIVE_EVENTS_HUB.idFromName(HUB_NAME);
  const stub = env.LIVE_EVENTS_HUB.get(id);
  // Forward the upgrade to the DO's /ws path.
  return stub.fetch(new Request('https://do/ws', request));
}
