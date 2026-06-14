// ABOUTME: Cloudflare Worker entry point for the event collection API.
// ABOUTME: Routes HTTP requests to ingest, recent, stats, export, participant, and subscribe handlers.

import { handleIngest } from './routes/ingest';
import { handleRecent } from './routes/recent';
import { handleDailyCounts } from './routes/dailyCounts';
import { handleStats } from './routes/stats';
import { handleExport } from './routes/export';
import { handleParticipantUpsert } from './routes/participants';
import { handleSubscribe } from './routes/subscribe';
import { handlePageMeta } from './routes/pageMeta';
import { handleStream } from './routes/stream';
import { isAllowedOrigin, forbiddenResponse } from './lib/originAllowlist';
import { scheduleCollectionEventsArchive } from './archive/collectionEvents';
import type { Env } from './lib/supabase';

export { LiveEventsHub } from './live/LiveEventsHub';

/**
 * Cloudflare Worker entry point
 * Routes requests to appropriate handlers
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }
    
    // Route requests
    if (path === '/events' && request.method === 'POST') {
      return handleIngest(request, env, ctx);
    }

    if (path === '/stream' && request.method === 'GET') {
      if (!isAllowedOrigin(request)) return forbiddenResponse();
      return handleStream(request, env);
    }

    if (path === '/events/recent' && request.method === 'GET') {
      if (!isAllowedOrigin(request)) return forbiddenResponse();
      return handleRecent(request, env);
    }

    if (path === '/events/daily-counts' && request.method === 'GET') {
      if (!isAllowedOrigin(request)) return forbiddenResponse();
      return handleDailyCounts(request, env);
    }
    
    if (path === '/events/stats' && request.method === 'GET') {
      return handleStats(request, env);
    }
    
    if (path === '/events/export' && request.method === 'POST') {
      return handleExport(request, env);
    }

    if (path === '/subscribe' && request.method === 'POST') {
      return handleSubscribe(request, env);
    }

    if (path === '/page-meta' && request.method === 'GET') {
      if (!isAllowedOrigin(request)) return forbiddenResponse();
      return handlePageMeta(request, env);
    }

    // Match PUT /participants/:pid
    const participantMatch = path.match(/^\/participants\/(.+)$/);
    if (participantMatch && request.method === 'PUT') {
      return handleParticipantUpsert(request, env, decodeURIComponent(participantMatch[1]));
    }

    // Health check
    if (path === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // 404 for unknown routes
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    scheduleCollectionEventsArchive(env, ctx);
  },
};
