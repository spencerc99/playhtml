#!/usr/bin/env bash
# ABOUTME: Verifies page_events_page, which pages one page's events by md5(url) hash, against real PostgreSQL.
# ABOUTME: Checks the index migration's locking, paging, hash dedupe, the four-hash cap, the keyset edge, the limit clamp, index use, and grants.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
index_migration_path="$script_dir/../migrations/20261118010000_extension_events_urlhash_type_ts_index.sql"
migration_path="$script_dir/../migrations/20261118010100_extension_page_events.sql"
container="page-events-page-test-$$"
ids_file="$(mktemp)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "$ids_file"
}
trap cleanup EXIT

run_sql() {
  docker exec "$container" psql -X -v ON_ERROR_STOP=1 -At -U postgres -d playhtml -c "$1"
}

# Applies the index migration in one transaction, as the Supabase tooling does, and prints
# how many locks the session holds on the table or the index just before it commits.
apply_index_migration() {
  docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -At -U postgres -d playhtml <<'SQL'
begin;
\i /urlhash_type_ts_index.sql
select count(*) from pg_locks
  where pid = pg_backend_pid()
    and locktype = 'relation'
    and relation in (select oid from pg_class where relname in ('collection_events', 'idx_events_urlhash_type_ts'));
commit;
SQL
}

# Runs a statement with auto_explain logging the plans of the statements inside
# page_events_page as they actually ran, and prints them.
function_plan() {
  docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -At -U postgres -d playhtml 2>&1 >/dev/null <<SQL
load 'auto_explain';
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set client_min_messages = log;
$1;
SQL
}

# The "rows=N" of the plan line that reads through idx_events_urlhash_type_ts.
index_scan_rows() {
  grep "Index Scan using idx_events_urlhash_type_ts" <<<"$1" | sed -E 's/.*actual time=[^ ]+ rows=([0-9]+) .*/\1/'
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
# The older production page index (20260710201355_production_schema.sql). It is still
# there when this ships and is dropped by hand later; the function must not need it.
run_sql "create index idx_events_urlhash_ts on public.collection_events using btree (md5(url), ts desc)" >/dev/null

cat_url="https://en.wikipedia.org/wiki/Cat"
slash_url="https://en.wikipedia.org/wiki/Cat/"

# 2,000 other pages x 100 events each, so the page's own rows are a small slice of the table.
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'n' || u || '-' || k, case when k % 10 = 0 then 'navigation' else 'cursor' end,
         timestamptz '2026-01-01' + (k * 2000 + u) * interval '1 second', 'p', 's',
         'https://example.com/n/' || u, '{}'::jsonb
  from generate_series(1, 2000) u, generate_series(1, 100) k" >/dev/null
# The page as stored without a trailing slash: 1,200 cursor and 100 navigation events.
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'cat-' || lpad(n::text, 4, '0'), 'cursor', timestamptz '2026-03-01' + n * interval '1 second', 'p', 's', '$cat_url', '{}'::jsonb
  from generate_series(1, 1200) n" >/dev/null
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'catnav-' || lpad(n::text, 3, '0'), 'navigation', timestamptz '2026-03-02' + n * interval '1 second', 'p', 's', '$cat_url', '{}'::jsonb
  from generate_series(1, 100) n" >/dev/null
# The same page stored with a trailing slash: 20 cursor events.
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'slash-' || lpad(n::text, 2, '0'), 'cursor', timestamptz '2026-04-01' + n * interval '1 second', 'p', 's', '$slash_url', '{}'::jsonb
  from generate_series(1, 20) n" >/dev/null
# Both forms also have events sharing one timestamp, so the id tiebreak has to page
# across the two hashes correctly.
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'tie-a-' || lpad(n::text, 2, '0'), 'cursor', timestamptz '2026-06-01', 'p', 's', '$cat_url', '{}'::jsonb
  from generate_series(1, 10) n" >/dev/null
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'tie-b-' || lpad(n::text, 2, '0'), 'cursor', timestamptz '2026-06-01', 'p', 's', '$slash_url', '{}'::jsonb
  from generate_series(1, 5) n" >/dev/null
# Five more pages with three events each, for the four-hash cap.
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'cap-' || i || '-' || j, 'cursor', timestamptz '2026-05-01' + (i * 10 + j) * interval '1 second', 'p', 's',
         'https://cap.example/' || i, '{}'::jsonb
  from generate_series(1, 5) i, generate_series(1, 3) j" >/dev/null

# A busy page: 200,000 cursor events and 50 keyboard events, newest keyboard events oldest
# of all, so reading the page newest first would pass every cursor row before finding them.
busy_url="https://busy.example/"
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'busy-' || n, 'cursor', timestamptz '2026-07-01' + n * interval '1 second', 'p', 's', '$busy_url', '{}'::jsonb
  from generate_series(1, 200000) n" >/dev/null
run_sql "insert into public.collection_events (id, type, ts, participant_id, session_id, url, data)
  select 'busykey-' || n, 'keyboard', timestamptz '2026-06-15' + n * interval '1 second', 'p', 's', '$busy_url', '{}'::jsonb
  from generate_series(1, 50) n" >/dev/null

# The index migration, with the index absent: it builds the index, which takes a lock.
docker cp "$index_migration_path" "$container:/urlhash_type_ts_index.sql"
absent_locks="$(apply_index_migration)"
if [[ "$absent_locks" -lt 1 ]]; then
  echo "Building the index held no lock, so the lock count below proves nothing" >&2
  exit 1
fi
assert_equals "t" "$(run_sql "select indisvalid from pg_index where indexrelid = 'public.idx_events_urlhash_type_ts'::regclass")"
assert_equals "CREATE INDEX idx_events_urlhash_type_ts ON public.collection_events USING btree (md5(url), type, ts DESC)" "$(run_sql "select pg_get_indexdef('public.idx_events_urlhash_type_ts'::regclass)")"
# With a valid index already there (production, built concurrently by hand), the
# migration takes no lock on the table or the index at all.
assert_equals "0" "$(apply_index_migration)"
# With an INVALID index left by an interrupted concurrent build, it stops instead of
# reporting success with no usable index.
run_sql "update pg_index set indisvalid = false where indexrelid = 'public.idx_events_urlhash_type_ts'::regclass" >/dev/null
if invalid_output="$(apply_index_migration 2>&1)"; then
  echo "The index migration accepted an INVALID index" >&2
  exit 1
fi
if ! grep -q "idx_events_urlhash_type_ts exists but is INVALID" <<<"$invalid_output"; then
  echo "The index migration failed for another reason:" >&2
  echo "$invalid_output" >&2
  exit 1
fi
run_sql "update pg_index set indisvalid = true where indexrelid = 'public.idx_events_urlhash_type_ts'::regclass" >/dev/null
echo "index migration: absent -> built holding $absent_locks lock(s); valid -> 0 locks; invalid -> refused"

docker cp "$migration_path" "$container:/page_events_page.sql"
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d playhtml -f /page_events_page.sql >/dev/null
run_sql "analyze public.collection_events" >/dev/null

cat_hash="$(run_sql "select md5('$cat_url')")"
slash_hash="$(run_sql "select md5('$slash_url')")"
page_hashes="array['$cat_hash', '$slash_hash']"
cap_hashes=()
for i in 1 2 3 4 5; do
  cap_hashes+=("$(run_sql "select md5('https://cap.example/$i')")")
done

# Every cursor event of the page under both stored forms, newest first with the id tiebreak.
expected_ids="$(run_sql "select string_agg(id, ',' order by ts desc, id desc) from public.collection_events
  where url in ('$cat_url', '$slash_url') and type = 'cursor'")"
expected_count="$(run_sql "select count(*) from public.collection_events where url in ('$cat_url', '$slash_url') and type = 'cursor'")"
assert_equals "1235" "$expected_count"

# Page through them 250 at a time, passing the last row of each page as the cursor.
before_ts="infinity"
before_id=""
seen=0
pages=0
while :; do
  page="$(run_sql "select id || '|' || to_char(ts at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')
    from public.page_events_page($page_hashes, 'cursor', null, null, '$before_ts', '$before_id', 250)")"
  [[ -z "$page" ]] && break
  count="$(printf '%s\n' "$page" | wc -l | tr -d ' ')"
  printf '%s\n' "$page" | cut -d'|' -f1 >> "$ids_file"
  seen=$((seen + count))
  pages=$((pages + 1))
  last="$(printf '%s\n' "$page" | tail -1)"
  before_id="${last%%|*}"
  before_ts="${last##*|}"
  [[ "$count" -lt 250 ]] && break
done
assert_equals "$expected_count" "$seen"
assert_equals "5" "$pages"
assert_equals "$expected_ids" "$(paste -sd, "$ids_file")"

# Only the requested type comes back, and a null type matches nothing: every read
# names one type so it can be served from the (md5(url), type, ts) index in ts order.
assert_equals "100" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], 'navigation')")"
assert_equals "0" "$(run_sql "select count(*) from public.page_events_page($page_hashes, 'navigation') where url <> '$cat_url'")"
assert_equals "0" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], null)")"
assert_equals "900" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], 'cursor', '2026-03-01T00:05:01Z', '2026-03-02T00:01:40Z')")"

# A hash sent twice reads its page once, not once per copy.
assert_equals "25" "$(run_sql "select count(*) from public.page_events_page(array['$slash_hash', '$slash_hash'], 'cursor')")"
assert_equals "25" "$(run_sql "select count(distinct id) from public.page_events_page(array['$slash_hash', '$slash_hash'], 'cursor')")"

# Only the first four hashes are read; a fifth is ignored.
cap_array="array['${cap_hashes[0]}', '${cap_hashes[1]}', '${cap_hashes[2]}', '${cap_hashes[3]}', '${cap_hashes[4]}']"
assert_equals "12" "$(run_sql "select count(*) from public.page_events_page($cap_array, 'cursor')")"
assert_equals "0" "$(run_sql "select count(*) from public.page_events_page($cap_array, 'cursor') where url = 'https://cap.example/5'")"
# Anything that is not a lowercase md5 digest matches nothing.
assert_equals "25" "$(run_sql "select count(*) from public.page_events_page(array['not a hash', upper('$cat_hash'), '$slash_hash'], 'cursor')")"

# The keyset edge: a cursor inside a run of equal timestamps continues by id, across both
# hashes, and an empty cursor id at a timestamp skips every row at that timestamp.
assert_equals "tie-b-05,tie-b-04" "$(run_sql "select string_agg(id, ',') from (select id from public.page_events_page($page_hashes, 'cursor', null, null, 'infinity', '', 2)) t")"
assert_equals "tie-b-01,tie-a-10,tie-a-09" "$(run_sql "select string_agg(id, ',') from (select id from public.page_events_page($page_hashes, 'cursor', null, null, '2026-06-01T00:00:00Z', 'tie-b-02', 3)) t")"
assert_equals "slash-20" "$(run_sql "select string_agg(id, ',') from (select id from public.page_events_page($page_hashes, 'cursor', null, null, '2026-06-01T00:00:00Z', '', 1)) t")"
# The from and to bounds are inclusive.
assert_equals "15" "$(run_sql "select count(*) from public.page_events_page($page_hashes, 'cursor', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')")"

# The page size is held to between 1 and 1,000.
assert_equals "1000" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], 'cursor', null, null, 'infinity', '', 5000)")"
assert_equals "1" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], 'cursor', null, null, 'infinity', '', 0)")"
assert_equals "1" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], 'cursor', null, null, 'infinity', '', -5)")"

# A type that is rare on a busy page is read straight from the (md5(url), type, ts)
# index: the plan of the function's own statement names the index, puts the type in
# its index condition, and reads only the 50 keyboard rows, not the 200,000 cursor rows.
busy_hash="$(run_sql "select md5('$busy_url')")"
check_rare_type_plan() {
  local plan
  plan="$(function_plan "select count(*) from public.page_events_page(array['$busy_hash'], 'keyboard')")"
  if ! grep -q "Index Scan using idx_events_urlhash_type_ts" <<<"$plan" \
    || ! grep -Eq "Index Cond: .*type = " <<<"$plan" \
    || grep -q "Rows Removed by Filter" <<<"$plan" \
    || [[ "$(index_scan_rows "$plan")" != "50" ]]; then
    echo "A rare type on a busy page was not read through idx_events_urlhash_type_ts alone ($1):" >&2
    echo "$plan" >&2
    exit 1
  fi
  echo "rare type on a busy page ($1):"
  grep -E "Index Scan using|Index Cond|Buffers" <<<"$plan" | sed 's/^/  /'
}
assert_equals "50" "$(run_sql "select count(*) from public.page_events_page(array['$busy_hash'], 'keyboard')")"
check_rare_type_plan "both page indexes present"

# A common type on the same page stops after one page of rows. The index orders by ts
# only, so an incremental sort orders each run of equal timestamps by id and reads at
# most one row past the page; a full sort would read all 200,000 cursor rows first.
cursor_plan="$(function_plan "select count(*) from public.page_events_page(array['$busy_hash'], 'cursor')")"
if ! grep -q "Incremental Sort" <<<"$cursor_plan" || [[ "$(index_scan_rows "$cursor_plan")" -gt 1001 ]] || grep -q "JIT:" <<<"$cursor_plan"; then
  echo "A common type on a busy page did not stop after one page through idx_events_urlhash_type_ts:" >&2
  echo "$cursor_plan" >&2
  exit 1
fi

# A time window bounds the index range: a 100-second window of that page reads 100 rows.
window_plan="$(function_plan "select count(*) from public.page_events_page(array['$busy_hash'], 'cursor', '2026-07-01T12:00:01Z', '2026-07-01T12:01:40Z')")"
if [[ "$(index_scan_rows "$window_plan")" != "100" ]] || grep -q "Rows Removed by Filter" <<<"$window_plan"; then
  echo "A time window on a busy page was not read as an index range:" >&2
  echo "$window_plan" >&2
  exit 1
fi

# Browser roles cannot read a page's history through the function. In Supabase they can
# read the table itself (row security decides what they see), so they get that access here
# too, and only the function's own grant stands in the way.
run_sql "grant usage on schema public to anon, authenticated, service_role; grant select on public.collection_events to anon, authenticated, service_role" >/dev/null
signature="public.page_events_page(text[], text, timestamptz, timestamptz, timestamptz, text, integer)"
for role in anon authenticated; do
  assert_equals "f" "$(run_sql "select has_function_privilege('$role', '$signature', 'execute')")"
  if run_sql "set role $role; select count(*) from public.page_events_page(array['$cat_hash'], 'cursor')" >/dev/null 2>&1; then
    echo "$role was able to call page_events_page" >&2
    exit 1
  fi
done
# The Worker's service role can.
assert_equals "t" "$(run_sql "select has_function_privilege('service_role', '$signature', 'execute')")"
assert_equals "1000" "$(run_sql "set role service_role; select count(*) from public.page_events_page(array['$cat_hash'], 'cursor')" | tail -1)"

# Once the older page index is dropped by hand, nothing changes.
run_sql "drop index public.idx_events_urlhash_ts" >/dev/null
check_rare_type_plan "older page index dropped"

echo "page events page: ok"
