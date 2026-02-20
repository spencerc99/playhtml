import { createClient } from '@supabase/supabase-js';

/**
 * Create Supabase client with credentials from environment
 */
export function createSupabaseClient(env: Env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SECRET_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials in environment');
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Environment interface for Cloudflare Worker
 * 
 * Security model:
 * - SUPABASE_SECRET_KEY: Never exposed to clients, only used server-side
 * - ADMIN_KEY: Required for admin endpoints (stats, export) to protect user data
 * 
 * The ingest endpoint is public but validated. Admin endpoints require ADMIN_KEY
 * because even though data is anonymous, we're collecting it from real users
 * and should protect access to aggregated/exported data.
 * 
 * Future: Consider adding CORS restrictions to admin endpoints as additional layer.
 */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;  // Supabase "secret" API key (full database access)
  ADMIN_KEY: string;            // Required for admin endpoints (stats, export)
}
