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

# 3. Page title saving. Its migration (20261007000000) needs exactly one current row per
# page, a filled latest_observed_at_ts column and a unique index. The table holds millions of
# rows, so this does the same work in small committed pieces instead of one transaction:
# nothing is locked for more than a moment, and a dropped connection loses at most one
# batch. Every piece is safe to rerun. Closing duplicate rows is a data change, so it only
# runs when CLOSE_DUPLICATE_TITLES=1.

# Runs SQL from stdin with psql variables (-v name=value), so values are quoted by psql.
sql_with() {
  psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 -c "set statement_timeout = 0" "$@" -f -
}

# Retries a brief DDL statement that needs a table lock, so it never queues traffic for long.
brief_ddl() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
        -c "set lock_timeout = '3s'" -c "$1" >/dev/null 2>&1; then
      return 0
    fi
    say "  waiting for a quiet moment on the page title table (try $attempt)"
    sleep 5
  done
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "set lock_timeout = '3s'" -c "$1"
}

title_index_unique() {
  sql "select coalesce((select i.indisunique and i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname = 'idx_page_metadata_history_current' and c.relnamespace = 'public'::regnamespace), false)"
}

if [[ "$page_metadata_present" != "t" ]]; then
  say "Checking page titles for pages with more than one current row (a few minutes)."
  duplicate_pages="$(sql "select count(*) from (select 1 from public.page_metadata_history
    where valid_to_ts is null group by page_ref having count(*) > 1) d")"

  if [[ "$duplicate_pages" != "0" ]]; then
    if [[ "${CLOSE_DUPLICATE_TITLES:-}" != "1" ]]; then
      say "Found $duplicate_pages pages with more than one current title row."
      say "To fix page title saving, rerun with CLOSE_DUPLICATE_TITLES=1. For each page that keeps the"
      say "newest row as current and ends each older one when the next began. Nothing else was changed."
      exit 2
    fi
    say "Closing older current rows on $duplicate_pages pages, about 20,000 current rows at a time."
    last=""
    closed_total=0
    while :; do
      # The page_ref that ends this batch; empty when the rest fits in one batch.
      upto="$(sql_with -v last="$last" <<'SQL'
select page_ref from public.page_metadata_history
where valid_to_ts is null and page_ref > :'last'
order by page_ref offset 19999 limit 1;
SQL
)"
      closed="$(sql_with -v last="$last" -v upto="$upto" <<'SQL'
with ranked as (
  select id, lead(valid_from_ts) over (
    partition by page_ref order by valid_from_ts, created_at, id) as next_from
  from public.page_metadata_history
  where valid_to_ts is null
    and page_ref > :'last'
    and (:'upto' = '' or page_ref <= :'upto'))
, closed as (
  update public.page_metadata_history h
  set valid_to_ts = r.next_from
  from ranked r
  where h.id = r.id and r.next_from is not null
  returning 1)
select count(*) from closed;
SQL
)"
      closed_total=$((closed_total + closed))
      say "  closed $closed_total rows so far"
      [[ -z "$upto" ]] && break
      last="$upto"
    done
  fi

  # Shorter than the old migration's single UPDATE: an empty nullable column is instant.
  brief_ddl "alter table public.page_metadata_history add column if not exists latest_observed_at_ts timestamptz"

  pages="$(sql "select greatest(pg_relation_size('public.page_metadata_history') / current_setting('block_size')::int, 1)")"
  step=4000
  say "Filling latest_observed_at_ts, $step table pages (about 50,000 rows) at a time."
  for ((start = 0; start < pages; start += step)); do
    sql_with -v lo="($start,0)" -v hi="($((start + step)),0)" >/dev/null <<'SQL'
update public.page_metadata_history
set latest_observed_at_ts = valid_from_ts
where ctid >= :'lo'::tid and ctid < :'hi'::tid and latest_observed_at_ts is null;
SQL
    done_pages=$((start + step < pages ? start + step : pages))
    say "  $((done_pages * 100 / pages))% of the table filled"
  done
  # Rows moved by an update land with the column already filled; this catches anything else.
  sql "update public.page_metadata_history set latest_observed_at_ts = valid_from_ts
       where latest_observed_at_ts is null" >/dev/null

  if [[ "$(title_index_unique)" != "t" ]]; then
    say "Building the one-current-row-per-page index without locking the table."
    sql "drop index concurrently if exists public.idx_page_metadata_history_current_unique" >/dev/null
    sql "create unique index concurrently idx_page_metadata_history_current_unique
         on public.page_metadata_history (page_ref) where valid_to_ts is null" >/dev/null
    sql "drop index concurrently if exists public.idx_page_metadata_history_current" >/dev/null
    brief_ddl "alter index public.idx_page_metadata_history_current_unique rename to idx_page_metadata_history_current"
  fi

  say "Making latest_observed_at_ts required (checks the table without blocking it)."
  brief_ddl "alter table public.page_metadata_history drop constraint if exists page_metadata_history_latest_observed_present"
  brief_ddl "alter table public.page_metadata_history add constraint page_metadata_history_latest_observed_present
             check (latest_observed_at_ts is not null) not valid"
  sql "alter table public.page_metadata_history validate constraint page_metadata_history_latest_observed_present" >/dev/null
  # With a validated check in place, setting NOT NULL does not scan the table again.
  brief_ddl "alter table public.page_metadata_history alter column latest_observed_at_ts set not null"
  brief_ddl "alter table public.page_metadata_history drop constraint page_metadata_history_latest_observed_present"

  # The rest of the migration file defines the function that saves titles.
  awk '/^create or replace function public.record_page_metadata_snapshot/,0' \
    "$migrations_dir/${PAGE_METADATA_VERSION}_${PAGE_METADATA_NAME}.sql" \
    | psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f - >/dev/null
  say "Page titles will save again on the next upload."
fi
recorded "$PAGE_METADATA_VERSION" || record "$PAGE_METADATA_VERSION" "$PAGE_METADATA_NAME"

say "Production is caught up with the repository's migrations."
