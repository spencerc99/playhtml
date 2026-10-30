#!/usr/bin/env bash
# ABOUTME: Builds the participant restore index on a live database without blocking writes, then adds the restore function.
# ABOUTME: Prints build progress, retries an interrupted build, and is safe to rerun.

set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the Supabase session pooler connection string (not the 6543 transaction pooler)}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migration="$script_dir/../migrations/20261030014153_extension_participant_restore_index.sql"
index="idx_events_participant_key_type_ts"
progress_every="${PROGRESS_EVERY_SECONDS:-30}"

sql() {
  psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"
}

index_state() {
  sql "select coalesce(
    (select case when i.indisvalid then 'valid' else 'invalid' end
       from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relname = '$index' and c.relnamespace = 'public'::regnamespace),
    'missing')"
}

stamp() {
  date '+%H:%M:%S'
}

state="$(index_state)"
if [[ "$state" == "invalid" ]]; then
  echo "$(stamp) Found an interrupted build of $index; dropping it before starting again."
  sql "drop index concurrently if exists public.$index" >/dev/null
  state="missing"
fi

if [[ "$state" == "missing" ]]; then
  echo "$(stamp) Building $index. Writes keep working; this reads the whole table."
  # Each -c runs on its own, so the concurrent build stays outside a transaction,
  # and the session setting lifts the role's statement timeout for this connection only.
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "set statement_timeout = 0" \
    -c "set application_name = 'participant-restore-index'" \
    -c "create index concurrently if not exists $index on public.collection_events ((('x' || substr(md5(participant_id), 1, 8))::bit(32)::integer), type, ts desc)" &
  build_pid=$!

  waited=0
  while kill -0 "$build_pid" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    (( waited % progress_every == 0 )) || continue
    kill -0 "$build_pid" 2>/dev/null || break
    progress="$(sql "select phase
        || coalesce(', ' || round(100.0 * blocks_done / nullif(blocks_total, 0), 1) || '% of table read', '')
        || coalesce(', ' || round(100.0 * tuples_done / nullif(tuples_total, 0), 1) || '% of rows sorted', '')
      from pg_stat_progress_create_index
      where relid = 'public.collection_events'::regclass
      limit 1" 2>/dev/null || true)"
    echo "$(stamp) ${progress:-waiting for other transactions to finish}"
  done

  if ! wait "$build_pid"; then
    echo "$(stamp) The index build failed. Rerun this script; it drops the partial index and starts over." >&2
    exit 1
  fi
fi

state="$(index_state)"
if [[ "$state" != "valid" ]]; then
  echo "$(stamp) $index is $state after the build. Rerun this script to start over." >&2
  exit 1
fi
echo "$(stamp) $index is built and valid ($(sql "select pg_size_pretty(pg_relation_size('public.$index'))"))."

# The migration's own CREATE INDEX IF NOT EXISTS is a no-op now; this adds the function and grants.
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "set client_min_messages = warning" -f "$migration"
sql "select 'participant_events_page' from pg_proc where proname = 'participant_events_page'" | grep -q participant_events_page
echo "$(stamp) Restore function is in place. Done."
