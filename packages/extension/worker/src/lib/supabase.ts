import { createClient } from '@supabase/supabase-js';

/**
 * Create Supabase client with credentials from environment
 */
export function createSupabaseClient(env: Env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  
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
 */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_KEY: string;
}
