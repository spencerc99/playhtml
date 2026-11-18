#!/usr/bin/env bash
# ABOUTME: Verifies page_events_page, which pages one page's events by md5(url) hash, against real PostgreSQL.
# ABOUTME: Checks paging across URL forms, hash dedupe, the four-hash cap, the keyset edge, the limit clamp, index use, and grants.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
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
# The production index the function reads through (20260710201355_production_schema.sql).
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

# Only the requested type comes back, and no type means every type.
assert_equals "100" "$(run_sql "select count(*) from public.page_events_page(array['$cat_hash'], 'navigation')")"
assert_equals "0" "$(run_sql "select count(*) from public.page_events_page($page_hashes, 'navigation') where url <> '$cat_url'")"
assert_equals "cursor:900,navigation:100" "$(run_sql "select string_agg(type || ':' || n, ',' order by type) from (
  select type, count(*) n from public.page_events_page(array['$cat_hash'], null, '2026-03-01T00:05:01Z', '2026-03-02T00:01:40Z') group by type) t")"

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

# Each hash is read through the page URL index, not a scan of every page. The function
# turns bitmap scans off, so the plan is checked the same way.
page_query="select e.* from public.collection_events e
  where md5(e.url) = '$cat_hash' and e.type = 'cursor' and e.ts <= 'infinity' and (e.ts, e.id) < ('infinity', '')
  order by e.ts desc, e.id desc limit 1000"
plan="$(run_sql "set enable_bitmapscan = off; explain $page_query")"
if ! grep -q "idx_events_urlhash_ts" <<<"$plan"; then
  echo "The planner did not read the page through the page URL index:" >&2
  echo "$plan" >&2
  exit 1
fi

# Browser roles cannot read a page's history through the function. In Supabase they can
# read the table itself (row security decides what they see), so they get that access here
# too, and only the function's own grant stands in the way.
run_sql "grant usage on schema public to anon, authenticated, service_role; grant select on public.collection_events to anon, authenticated, service_role" >/dev/null
signature="public.page_events_page(text[], text, timestamptz, timestamptz, timestamptz, text, integer)"
for role in anon authenticated; do
  assert_equals "f" "$(run_sql "select has_function_privilege('$role', '$signature', 'execute')")"
  if run_sql "set role $role; select count(*) from public.page_events_page(array['$cat_hash'])" >/dev/null 2>&1; then
    echo "$role was able to call page_events_page" >&2
    exit 1
  fi
done
# The Worker's service role can.
assert_equals "t" "$(run_sql "select has_function_privilege('service_role', '$signature', 'execute')")"
assert_equals "1000" "$(run_sql "set role service_role; select count(*) from public.page_events_page(array['$cat_hash'])" | tail -1)"

echo "page events page: ok"
