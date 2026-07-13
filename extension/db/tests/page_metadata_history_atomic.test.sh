#!/usr/bin/env bash
# ABOUTME: Verifies page metadata history transitions against real PostgreSQL.
# ABOUTME: Exercises watermark handling and advisory-lock serialization.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migration_path="$script_dir/../migrations/page_metadata_history_atomic.sql"
container="page-metadata-history-test-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_sql() {
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -At -U postgres -d playhtml -c "$1"
}

assert_equals() {
  if [[ "$1" != "$2" ]]; then
    echo "Expected '$1', got '$2'" >&2
    exit 1
  fi
}

call_snapshot() {
  run_sql "select public.record_page_metadata_snapshot('$1', 'https://example.com/', '$2', '', '$3', '$4'::timestamptz)"
}

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=playhtml postgres:15-alpine >/dev/null

until run_sql "select 1" >/dev/null 2>&1; do
  sleep 0.1
done

run_sql "create extension if not exists pgcrypto" >/dev/null
run_sql "create table public.page_metadata_history (id uuid primary key default gen_random_uuid(), page_ref text not null, canonical_url text not null, title text not null, favicon_url text not null, metadata_hash text not null, valid_from_ts timestamptz not null, valid_to_ts timestamptz null, created_at timestamptz not null default now())" >/dev/null
run_sql "create index idx_page_metadata_history_current on public.page_metadata_history (page_ref) where valid_to_ts is null" >/dev/null
docker cp "$migration_path" "$container:/page_metadata_history_atomic.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d playhtml -f /page_metadata_history_atomic.sql >/dev/null

assert_equals "t" "$(call_snapshot page-watermark A hash-a '1970-01-01T00:01:40Z')"
assert_equals "f" "$(call_snapshot page-watermark A hash-a '1970-01-01T00:05:00Z')"
assert_equals "f" "$(call_snapshot page-watermark B hash-b '1970-01-01T00:03:20Z')"
assert_equals "hash-a" "$(run_sql "select metadata_hash from public.page_metadata_history where page_ref = 'page-watermark' and valid_to_ts is null")"
assert_equals "t" "$(run_sql "select valid_from_ts = '1970-01-01T00:01:40Z'::timestamptz from public.page_metadata_history where page_ref = 'page-watermark' and valid_to_ts is null")"
assert_equals "t" "$(run_sql "select latest_observed_at_ts = '1970-01-01T00:05:00Z'::timestamptz from public.page_metadata_history where page_ref = 'page-watermark' and valid_to_ts is null")"

assert_equals "t" "$(call_snapshot page-concurrent A hash-a '1970-01-01T00:01:40Z')"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d playhtml -c "begin; select pg_advisory_xact_lock(hashtextextended('page-concurrent', 0)); select pg_sleep(1); commit" >/dev/null &
lock_pid=$!

for _ in $(seq 1 50); do
  if [[ "$(run_sql "select count(*) from pg_locks where locktype = 'advisory'")" -gt 0 ]]; then
    break
  fi
  sleep 0.1
done

call_snapshot page-concurrent B hash-b '1970-01-01T00:03:20Z' >/dev/null &
older_pid=$!
call_snapshot page-concurrent A hash-a '1970-01-01T00:05:00Z' >/dev/null &
newer_pid=$!

wait "$lock_pid" "$older_pid" "$newer_pid"

assert_equals "1" "$(run_sql "select count(*) from public.page_metadata_history where page_ref = 'page-concurrent' and valid_to_ts is null")"
assert_equals "hash-a" "$(run_sql "select metadata_hash from public.page_metadata_history where page_ref = 'page-concurrent' and valid_to_ts is null")"
assert_equals "t" "$(run_sql "select latest_observed_at_ts = '1970-01-01T00:05:00Z'::timestamptz from public.page_metadata_history where page_ref = 'page-concurrent' and valid_to_ts is null")"
