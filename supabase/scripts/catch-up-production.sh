#!/usr/bin/env bash
# ABOUTME: Brings the production database up to the repository's migrations that were merged but never applied.
# ABOUTME: Checks first, applies each missing migration with progress, records it as applied, and is safe to rerun.

set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the Supabase session pooler connection string (not the 6543 transaction pooler)}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migrations_dir="$script_dir/../migrations"
progress_every="${PROGRESS_EVERY_SECONDS:-30}"
restore_index="idx_events_participant_key_type_ts"

QUARANTINE_VERSION="20260723000516"
QUARANTINE_NAME="extension_quarantine_tape"
PAGE_METADATA_VERSION="20261007000000"
PAGE_METADATA_NAME="extension_page_metadata_history_atomic"
RESTORE_VERSION="20261030014153"
RESTORE_NAME="extension_participant_restore_index"

sql() {
  psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 -c "set statement_timeout = 0" -c "$1"
}

stamp() {
  date '+%H:%M:%S'
}

say() {
  echo "$(stamp) $*"
}

recorded() {
  [[ "$(sql "select count(*) from supabase_migrations.schema_migrations where version = '$1'")" != "0" ]]
}

record() {
  sql "insert into supabase_migrations.schema_migrations (version, name)
       select '$1', '$2'
       where not exists (select 1 from supabase_migrations.schema_migrations where version = '$1')" >/dev/null
  say "Recorded $1_$2 as applied."
}

# Runs a command in the background and prints a line every $progress_every seconds
# from the given progress query until it finishes.
with_progress() {
  local progress_sql="$1"
  shift
  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    (( waited % progress_every == 0 )) || continue
    kill -0 "$pid" 2>/dev/null || break
    local progress=""
    if [[ -n "$progress_sql" ]]; then
      progress="$(sql "$progress_sql" 2>/dev/null || true)"
    fi
    say "  still working (${waited}s)${progress:+: $progress}"
  done
  wait "$pid"
}

apply_file() {
  # One transaction per migration; a lock wait gives up rather than queueing traffic behind it.
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction \
    -c "set statement_timeout = 0" \
    -c "set lock_timeout = '15s'" \
    -c "set client_min_messages = warning" \
    -f "$1"
}

say "Checking production."
sql "select 1" >/dev/null

quarantine_present="$(sql "select to_regclass('public.quarantine_strips') is not null")"
page_metadata_present="$(sql "select exists (select 1 from pg_proc where proname = 'record_page_metadata_snapshot')")"
restore_present="$(sql "select exists (select 1 from pg_proc where proname = 'participant_events_page')")"
say "  quarantine tape table:           $([[ $quarantine_present == t ]] && echo present || echo missing)"
say "  page title saving function:      $([[ $page_metadata_present == t ]] && echo present || echo missing)"
say "  participant restore function:    $([[ $restore_present == t ]] && echo present || echo missing)"

# 1. Quarantine tape: one new table.
if [[ "$quarantine_present" != "t" ]]; then
  say "Applying $QUARANTINE_NAME (new table)."
  apply_file "$migrations_dir/${QUARANTINE_VERSION}_${QUARANTINE_NAME}.sql"
fi
recorded "$QUARANTINE_VERSION" || record "$QUARANTINE_VERSION" "$QUARANTINE_NAME"

# 2. Participant restore index. Built concurrently: event uploads keep working.
index_state() {
  sql "select coalesce(
    (select case when i.indisvalid then 'valid' else 'invalid' end
       from pg_index i join pg_class c on c.oid = i.indexrelid
      where c.relname = '$restore_index' and c.relnamespace = 'public'::regnamespace),
    'missing')"
}

state="$(index_state)"
if [[ "$state" == "invalid" ]]; then
  say "Found an interrupted build of $restore_index; dropping it before starting again."
  sql "drop index concurrently if exists public.$restore_index" >/dev/null
  state="missing"
fi
if [[ "$state" == "missing" ]]; then
  say "Building $restore_index. Event uploads keep working; this reads the whole events table (up to an hour)."
  build_index() {
    psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
      -c "set statement_timeout = 0" \
      -c "set application_name = 'participant-restore-index'" \
      -c "create index concurrently if not exists $restore_index on public.collection_events ((('x' || substr(md5(participant_id), 1, 8))::bit(32)::integer), type, ts desc)"
  }
  if ! with_progress "select phase
        || coalesce(', ' || round(100.0 * blocks_done / nullif(blocks_total, 0), 1) || '% of table read', '')
        || coalesce(', ' || round(100.0 * tuples_done / nullif(tuples_total, 0), 1) || '% of rows sorted', '')
      from pg_stat_progress_create_index
      where relid = 'public.collection_events'::regclass
      limit 1" build_index; then
    say "The index build failed. Rerun this script; it drops the partial index and starts over." >&2
    exit 1
  fi
fi
state="$(index_state)"
if [[ "$state" != "valid" ]]; then
  say "$restore_index is $state after the build. Rerun this script to start over." >&2
  exit 1
fi
say "$restore_index is built and valid ($(sql "select pg_size_pretty(pg_relation_size('public.$restore_index'))"))."

if [[ "$restore_present" != "t" ]]; then
  # The migration's CREATE INDEX IF NOT EXISTS is a no-op now; this adds the function and grants.
  apply_file "$migrations_dir/${RESTORE_VERSION}_${RESTORE_NAME}.sql"
  say "Restore function added."
fi
recorded "$RESTORE_VERSION" || record "$RESTORE_VERSION" "$RESTORE_NAME"

# 3. Page title saving. Its migration needs exactly one current row per page, and the old
# non-unique index let duplicates pile up. Closing them is a data change, so it only runs
# when CLOSE_DUPLICATE_TITLES=1; otherwise this step reports what it would do and stops.
if [[ "$page_metadata_present" != "t" ]]; then
  say "Checking page titles for pages with more than one current row (reads every current row; a few minutes)."
  duplicate_summary="$(sql "select count(*) || ' pages, ' || coalesce(sum(n - 1), 0) || ' extra current rows'
    from (select count(*) n from public.page_metadata_history
          where valid_to_ts is null group by page_ref having count(*) > 1) d")"
  if [[ "$duplicate_summary" != 0\ pages* ]]; then
    if [[ "${CLOSE_DUPLICATE_TITLES:-}" != "1" ]]; then
      say "Found $duplicate_summary."
      say "To fix page title saving, rerun with CLOSE_DUPLICATE_TITLES=1. For each page that keeps the"
      say "newest row as current and ends each older one when the next began. Nothing else was changed."
      exit 2
    fi
    say "Closing $duplicate_summary, then applying $PAGE_METADATA_NAME, in one transaction."
  else
    say "No duplicate current rows. Applying $PAGE_METADATA_NAME. This rewrites the page title table."
  fi
  apply_titles() {
    psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction \
      -c "set statement_timeout = 0" \
      -c "set lock_timeout = '15s'" \
      -c "set client_min_messages = warning" \
      -c "with ranked as (
            select id, lead(valid_from_ts) over (
              partition by page_ref order by valid_from_ts, created_at, id) as next_from
            from public.page_metadata_history
            where valid_to_ts is null)
          update public.page_metadata_history h
          set valid_to_ts = r.next_from
          from ranked r
          where h.id = r.id and r.next_from is not null" \
      -f "$migrations_dir/${PAGE_METADATA_VERSION}_${PAGE_METADATA_NAME}.sql"
  }
  with_progress "" apply_titles
  say "Page titles will save again on the next upload."
fi
recorded "$PAGE_METADATA_VERSION" || record "$PAGE_METADATA_VERSION" "$PAGE_METADATA_NAME"

say "Production is caught up with the repository's migrations."
