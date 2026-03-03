// ABOUTME: Cloudflare Worker entry point for the event collection API.
// ABOUTME: Routes HTTP requests to ingest, recent, stats, export, and participant handlers.

import { handleIngest } from './routes/ingest';
import { handleRecent } from './routes/recent';
import { handleStats } from './routes/stats';
import { handleExport } from './routes/export';
import { handleParticipantUpsert } from './routes/participants';
import type { Env } from './lib/supabase';

/**
 * Cloudflare Worker entry point
 * Routes requests to appropriate handlers
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return handleIngest(request, env);
    }
    
    if (path === '/events/recent' && request.method === 'GET') {
      return handleRecent(request, env);
    }
    
    if (path === '/events/stats' && request.method === 'GET') {
      return handleStats(request, env);
    }
    
    if (path === '/events/export' && request.method === 'POST') {
      return handleExport(request, env);
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
