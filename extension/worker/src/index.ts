// ABOUTME: Cloudflare Worker entry point for the event collection API.
// ABOUTME: Routes HTTP requests to event, participant, subscribe, and feedback handlers.

import { handleIngest } from './routes/ingest';
import { handleRecent } from './routes/recent';
import { handleDailyCounts } from './routes/dailyCounts';
import { handleStats } from './routes/stats';
import { handleExport } from './routes/export';
import { handleParticipantUpsert } from './routes/participants';
import { handleSubscribe } from './routes/subscribe';
import { handleFeedback } from './routes/feedback';
import { handlePageMeta } from './routes/pageMeta';
import { handleStream } from './routes/stream';
import { handleCommute } from './routes/commute';
import {
  handleAdminInternalAccessAdd,
  handleAdminInternalAccessList,
  handleAdminInternalAccessRemove,
  handleInternalAccessCheck,
} from './routes/internalAccess';
import { isAllowedOrigin, forbiddenResponse } from './lib/originAllowlist';
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
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

    if (path === '/commute/recent' && request.method === 'GET') {
      // This response is reduced to public destinations, domain-only scenery,
      // and aggregate counts. Extension-page GETs can omit Origin and Referer.
      return handleCommute(request, env);
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

    if (path === '/feedback' && request.method === 'POST') {
      return handleFeedback(request, env);
    }

    const internalAccessMatch = path.match(/^\/internal-access\/(.+)$/);
    if (internalAccessMatch && request.method === 'GET') {
      return handleInternalAccessCheck(
        env,
        decodeURIComponent(internalAccessMatch[1]),
      );
    }

    if (path === '/admin/internal-access') {
      if (request.method === 'GET') {
        return handleAdminInternalAccessList(request, env);
      }
      if (request.method === 'POST') {
        return handleAdminInternalAccessAdd(request, env);
      }
    }

    const adminInternalAccessMatch = path.match(
      /^\/admin\/internal-access\/(.+)$/,
    );
    if (adminInternalAccessMatch && request.method === 'DELETE') {
      return handleAdminInternalAccessRemove(
        request,
        env,
        decodeURIComponent(adminInternalAccessMatch[1]),
      );
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
};
