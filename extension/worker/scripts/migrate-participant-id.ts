// ABOUTME: One-time migration to rewrite old pid_* participant IDs to ECDSA public key
// ABOUTME: Run manually after extension generates new keypair

// Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... NEW_PID=pk_04a3... bun run scripts/migrate-participant-id.ts

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const NEW_PID = process.env.NEW_PID;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !NEW_PID) {
  console.error('Required: SUPABASE_URL, SUPABASE_SECRET_KEY, NEW_PID');
  process.exit(1);
}

if (!NEW_PID.startsWith('pk_') || NEW_PID.length < 100) {
  console.error('NEW_PID does not look like an ECDSA public key (expected pk_ + ~130 hex chars)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

async function migrate() {
  // Update all rows where participant_id starts with 'pid_' (old format)
  const { count, error } = await supabase
    .from('collection_events')
    .update({ participant_id: NEW_PID })
    .like('participant_id', 'pid_%');

  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }

  console.log(`Migrated ${count ?? 'unknown number of'} events to new participant ID: ${NEW_PID}`);
}

migrate();
