#!/usr/bin/env bash
# ABOUTME: Verifies participant event paging and its participant-key index against real PostgreSQL.
# ABOUTME: Checks cursor paging, participant isolation, index use, index size, and function grants.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migration_path="$script_dir/../migrations/20261030014153_extension_participant_restore_index.sql"
container="participant-events-restore-test-$$"

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

docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=playhtml postgres:15-alpine >/dev/null

until run_sql "select 1" >/dev/null 2>&1; do
  sleep 0.1
done

run_sql "create role anon nologin; create role authenticated nologin; create role service_role nologin" >/dev/null
run_sql "create table public.collection_events (id text primary key, type text not null, ts timestamptz not null, participant_id text not null, session_id text not null, url text, viewport_width integer, viewport_height integer, timezone text, data jsonb not null)" >/dev/null
run_sql "create index idx_events_type_ts_desc on public.collection_events (type, ts desc)" >/dev/null

# Participant ids have the production shape: "pk_" plus a 130-character hex public key.
pid_sql="'pk_04' || repeat(md5(p::text), 4)"
me="pk_04$(printf '%s' "$(run_sql "select repeat(md5('7'), 4)")")"

# 400 participants x 2,000 events with distinct millisecond timestamps, as in production.
# Participant 7 also has
# 25 events sharing one timestamp, so the id tiebreak has to page them correctly.
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, data)
  select 'e' || p || '-' || n, case when n % 10 = 0 then 'navigation' else 'cursor' end,
         timestamptz '2026-01-01' + (n * 400 + p) * 1013 * interval '1 millisecond', $pid_sql, 's', '{}'::jsonb
  from generate_series(1, 400) p, generate_series(1, 2000) n" >/dev/null
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, data)
  select 'tie-' || lpad(n::text, 2, '0'), 'cursor', timestamptz '2026-06-01', '$me', 's', '{}'::jsonb
  from generate_series(1, 25) n" >/dev/null

docker cp "$migration_path" "$container:/participant_events_restore.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d playhtml -f /participant_events_restore.sql >/dev/null
run_sql "analyze public.collection_events" >/dev/null

expected_cursor="$(run_sql "select count(*) from public.collection_events where participant_id = '$me' and type = 'cursor'")"
assert_equals "1825" "$expected_cursor"

# Page through every cursor event for one participant, 300 at a time.
before_ts="infinity"
before_id=""
seen=0
pages=0
: > /tmp/participant_events_restore_ids_$$
while :; do
  page="$(run_sql "select id || '|' || to_char(ts at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from public.participant_events_page('$me', 'cursor', '$before_ts', '$before_id', 300)")"
  [[ -z "$page" ]] && break
  count="$(printf '%s\n' "$page" | wc -l | tr -d ' ')"
  printf '%s\n' "$page" | cut -d'|' -f1 >> /tmp/participant_events_restore_ids_$$
  seen=$((seen + count))
  pages=$((pages + 1))
  last="$(printf '%s\n' "$page" | tail -1)"
  before_id="${last%%|*}"
  before_ts="${last##*|}"
  [[ "$count" -lt 300 ]] && break
done
assert_equals "$expected_cursor" "$seen"
assert_equals "$expected_cursor" "$(sort -u /tmp/participant_events_restore_ids_$$ | wc -l | tr -d ' ')"
assert_equals "7" "$pages"
rm -f /tmp/participant_events_restore_ids_$$

# Only the requested participant and type come back, newest first with the id tiebreak.
assert_equals "0" "$(run_sql "select count(*) from public.participant_events_page('$me', 'cursor', 'infinity', '', 1000) where participant_id <> '$me' or type <> 'cursor'")"
assert_equals "200" "$(run_sql "select count(*) from public.participant_events_page('$me', 'navigation', 'infinity', '', 1000)")"
assert_equals "tie-25,tie-24,tie-23" "$(run_sql "select string_agg(id, ',') from (select id from public.participant_events_page('$me', 'cursor', '2026-06-01T00:00:00.000001Z', '', 3)) t")"
assert_equals "tie-22,tie-21" "$(run_sql "select string_agg(id, ',') from (select id from public.participant_events_page('$me', 'cursor', '2026-06-01T00:00:00Z', 'tie-23', 2)) t")"
assert_equals "1000" "$(run_sql "select count(*) from public.participant_events_page('$me', 'cursor', 'infinity', '', 5000)")"

# The page query is answered from the participant-key index, not a scan of every participant.
plan="$(run_sql "set enable_seqscan = off; explain select e.* from public.collection_events e
  where ('x' || substr(md5(e.participant_id), 1, 8))::bit(32)::integer = ('x' || substr(md5('$me'), 1, 8))::bit(32)::integer
    and e.participant_id = '$me' and e.type = 'cursor' and e.ts <= 'infinity' and (e.ts, e.id) < ('infinity', '')
  order by e.ts desc, e.id desc limit 1000")"
if ! grep -q "idx_events_participant_key_type_ts" <<<"$plan"; then
  echo "Expected the participant-key index in the plan:" >&2
  echo "$plan" >&2
  exit 1
fi
plan_with_scans="$(run_sql "explain select e.* from public.collection_events e
  where ('x' || substr(md5(e.participant_id), 1, 8))::bit(32)::integer = ('x' || substr(md5('$me'), 1, 8))::bit(32)::integer
    and e.participant_id = '$me' and e.type = 'cursor' and e.ts <= 'infinity' and (e.ts, e.id) < ('infinity', '')
  order by e.ts desc, e.id desc limit 1000")"
if ! grep -q "idx_events_participant_key_type_ts" <<<"$plan_with_scans"; then
  echo "The planner preferred another path over the participant-key index:" >&2
  echo "$plan_with_scans" >&2
  exit 1
fi

# The key index stays close to the existing (type, ts) index in size. Both are rebuilt
# after loading so neither carries page splits from the inserts.
run_sql "reindex index public.idx_events_type_ts_desc; reindex index public.idx_events_participant_key_type_ts" >/dev/null
ratio="$(run_sql "select round(pg_relation_size('public.idx_events_participant_key_type_ts')::numeric / pg_relation_size('public.idx_events_type_ts_desc'), 2)")"
echo "participant-key index is ${ratio}x the size of idx_events_type_ts_desc"
assert_equals "t" "$(run_sql "select $ratio < 1.6")"

# Browser roles cannot read anyone's history through the function.
for role in anon authenticated; do
  if run_sql "set role $role; select count(*) from public.participant_events_page('$me', 'cursor')" >/dev/null 2>&1; then
    echo "$role was able to call participant_events_page" >&2
    exit 1
  fi
done
# The Worker's service role can, given the table access it has in Supabase.
run_sql "grant usage on schema public to service_role; grant select on public.collection_events to service_role" >/dev/null
assert_equals "1000" "$(run_sql "set role service_role; select count(*) from public.participant_events_page('$me', 'cursor')" | tail -1)"

echo "participant events restore: ok"
