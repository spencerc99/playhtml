-- ABOUTME: Maintain resumable navigation, audience, path, and metadata aggregates.
-- ABOUTME: Preserve session boundaries and invalidate snapshots when old source data changes.
create table internet_map.rollup_state (
  singleton boolean primary key default true check (singleton),
  watermark timestamptz,
  updated_at timestamptz,
  invalid_since timestamptz,
  processed_events bigint not null default 0,
  rejected_events bigint not null default 0,
  processed_metadata bigint not null default 0
);
insert into internet_map.rollup_state (singleton) values (true);

create table internet_map.pages (
  id bigint generated always as identity (start with 0 minvalue 0) primary key,
  page_key text collate "C" not null unique,
  host text collate "C" not null,
  domain text collate "C" not null,
  hits bigint not null default 0,
  first_ms bigint not null,
  last_ms bigint not null,
  in_page_events bigint not null default 0
);
create table internet_map.page_sessions (
  page bigint not null references internet_map.pages,
  session text collate "C" not null,
  primary key (page, session)
);
create index on internet_map.page_sessions (session, page);
create table internet_map.page_participants (
  page bigint not null references internet_map.pages,
  participant text collate "C" not null,
  primary key (page, participant)
);
create index on internet_map.page_participants (participant, page);
create table internet_map.jumps (
  a bigint not null references internet_map.pages,
  b bigint not null references internet_map.pages,
  raw_count bigint not null,
  primary key (a, b), check (a <> b)
);
create table internet_map.jump_sessions (
  a bigint not null, b bigint not null, session text collate "C" not null,
  primary key (a, b, session),
  foreign key (a, b) references internet_map.jumps
);
create table internet_map.triples (
  a bigint not null references internet_map.pages,
  b bigint not null references internet_map.pages,
  c bigint not null references internet_map.pages,
  count bigint not null,
  primary key (a, b, c), check (a < c and a <> b and b <> c)
);
-- Jump time tracks every event; run time tracks the FIRST event of a repeated page.
create table internet_map.session_state (
  session text collate "C" primary key,
  last_page bigint not null references internet_map.pages,
  last_ms bigint not null,
  run_ms bigint not null,
  prior_page bigint references internet_map.pages,
  prior_ms bigint
);
create table internet_map.titles (
  page_key text collate "C" not null,
  title text collate "C" not null,
  votes bigint not null,
  first_seen timestamptz not null,
  first_id uuid not null,
  primary key (page_key, title)
);
create table internet_map.host_favicons (
  host text collate "C" not null,
  favicon text collate "C" not null,
  votes bigint not null,
  first_seen timestamptz not null,
  first_id uuid not null,
  primary key (host, favicon)
);

create view internet_map.node_stats as
select p.id, p.hits, p.first_ms, p.last_ms, p.in_page_events,
  (select count(*) from internet_map.page_sessions s where s.page = p.id) as sessions,
  (select count(*) from internet_map.page_participants a where a.page = p.id) as participants
from internet_map.pages p;
create view internet_map.best_titles as
select distinct on (page_key) page_key, title from internet_map.titles
order by page_key, votes desc, first_seen, first_id, title;
create view internet_map.best_favicons as
select distinct on (host) host, favicon from internet_map.host_favicons
order by host, votes desc, first_seen, first_id, favicon;

create function internet_map.rollup(
  until_ts timestamptz default now() - interval '1 hour',
  chunk interval default interval '1 hour'
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, internet_map as $$
declare
  state internet_map.rollup_state%rowtype;
  start_ts timestamptz; end_ts timestamptz; row_cutoff timestamptz;
  event record; metadata record; normalized record; previous internet_map.session_state%rowtype;
  page_id bigint; ms bigint; title_value text; favicon_value text;
  event_count bigint := 0; rejected bigint := 0; metadata_count bigint := 0;
begin
  if chunk is null or chunk <= interval '0' or chunk > interval '1 day' then
    raise exception 'Rollup chunk must be between zero and one day';
  end if;
  if until_ts is null or until_ts > now() - interval '1 hour' then
    raise exception 'Rollup cutoff must be at least one hour old';
  end if;
  -- One lock also serializes source invalidation with the checkpoint commit.
  select * into state from internet_map.rollup_state where singleton for update;
  if state.invalid_since is not null then raise exception 'Rollup invalidated by source changes; rebuild required'; end if;
  start_ts := state.watermark;
  if start_ts is null then
    select least(
      (select min(ts) from public.collection_events where type = 'navigation'),
      (select min(valid_from_ts) from public.page_metadata_history)
    ) into start_ts;
  end if;
  if start_ts is null or start_ts >= until_ts then
    return jsonb_build_object('events', 0, 'metadata', 0, 'caught_up', true);
  end if;
  end_ts := least(start_ts + chunk, until_ts);
  -- Bound work by rows as well as time; never split equal timestamps between chunks.
  select least(
    (select ts from public.collection_events where type = 'navigation' and ts >= start_ts and ts < end_ts order by ts offset 5000 limit 1),
    (select valid_from_ts from public.page_metadata_history where valid_from_ts >= start_ts and valid_from_ts < end_ts order by valid_from_ts offset 5000 limit 1)
  ) into row_cutoff;
  if row_cutoff is not null then
    if row_cutoff = start_ts then raise exception 'More than 5000 source rows share the chunk boundary'; end if;
    end_ts := least(end_ts, row_cutoff);
  end if;
  -- Equal timestamps belong to one half-open chunk; event id resolves ties.
  for event in select id, ts, participant_id, session_id, url, data
    from public.collection_events
    where type = 'navigation' and ts >= start_ts and ts < end_ts
    order by ts, id collate "C"
  loop
    event_count := event_count + 1;
    select * into normalized from internet_map.normalise(coalesce(nullif(event.data->>'url', ''), event.url));
    if normalized.page_key = '' then rejected := rejected + 1; continue; end if;
    ms := floor(extract(epoch from event.ts) * 1000)::bigint;
    insert into internet_map.pages (page_key, host, domain, hits, first_ms, last_ms)
    values (normalized.page_key, normalized.host, internet_map.domain_of(normalized.host), 1, ms, ms)
    on conflict (page_key) do update set hits = pages.hits + 1,
      first_ms = least(pages.first_ms, excluded.first_ms), last_ms = greatest(pages.last_ms, excluded.last_ms)
    returning id into page_id;
    insert into internet_map.page_sessions values (page_id, event.session_id) on conflict do nothing;
    insert into internet_map.page_participants values (page_id, event.participant_id) on conflict do nothing;
    select * into previous from internet_map.session_state where session = event.session_id;
    if found then
      if previous.last_page = page_id then
        if ms - previous.last_ms <= 1800000 then
          update internet_map.pages set in_page_events = in_page_events + 1 where id = page_id;
        end if;
        update internet_map.session_state set last_ms = ms where session = event.session_id;
      else
        if ms - previous.last_ms <= 1800000 then
          insert into internet_map.jumps values (previous.last_page, page_id, 1)
          on conflict (a, b) do update set raw_count = jumps.raw_count + 1;
          insert into internet_map.jump_sessions values (previous.last_page, page_id, event.session_id) on conflict do nothing;
        end if;
        if previous.prior_page is not null and previous.prior_page <> page_id
           and previous.run_ms - previous.prior_ms <= 1800000 and ms - previous.run_ms <= 1800000 then
          insert into internet_map.triples values (least(previous.prior_page, page_id), previous.last_page,
            greatest(previous.prior_page, page_id), 1)
          on conflict (a, b, c) do update set count = triples.count + 1;
        end if;
        update internet_map.session_state set prior_page = previous.last_page, prior_ms = previous.run_ms,
          last_page = page_id, last_ms = ms, run_ms = ms where session = event.session_id;
      end if;
    else
      insert into internet_map.session_state (session, last_page, last_ms, run_ms)
      values (event.session_id, page_id, ms, ms);
    end if;
  end loop;
  for metadata in select id, canonical_url, title, favicon_url, valid_from_ts
    from public.page_metadata_history where valid_from_ts >= start_ts and valid_from_ts < end_ts
    order by valid_from_ts, id
  loop
    metadata_count := metadata_count + 1;
    select * into normalized from internet_map.normalise(metadata.canonical_url);
    if normalized.page_key = '' then continue; end if;
    title_value := internet_map.clean_title(metadata.title);
    if title_value <> '' then
      insert into internet_map.titles values (normalized.page_key, title_value, 1, metadata.valid_from_ts, metadata.id)
      on conflict (page_key, title) do update set votes = titles.votes + 1;
    end if;
    favicon_value := btrim(regexp_replace(metadata.favicon_url, '[[:space:]]+', ' ', 'g'));
    if favicon_value <> '' and length(favicon_value) < 400 and left(favicon_value, 5) <> 'data:' then
      insert into internet_map.host_favicons values (normalized.host, favicon_value, 1, metadata.valid_from_ts, metadata.id)
      on conflict (host, favicon) do update set votes = host_favicons.votes + 1;
    end if;
  end loop;
  update internet_map.rollup_state set watermark = end_ts, updated_at = clock_timestamp(),
    processed_events = processed_events + event_count, rejected_events = rejected_events + rejected,
    processed_metadata = processed_metadata + metadata_count where singleton;
  return jsonb_build_object('events', event_count, 'rejected', rejected, 'metadata', metadata_count,
    'watermark', end_ts, 'caught_up', end_ts >= until_ts);
end $$;

-- Ingestion is never rejected. A source edit behind the watermark blocks the next bake.
create function internet_map.invalidate_source() returns trigger
language plpgsql security definer set search_path = pg_catalog, internet_map as $$
declare old_ts timestamptz; new_ts timestamptz;
begin
  if TG_TABLE_NAME = 'collection_events' then
    if TG_OP <> 'INSERT' and OLD.type = 'navigation' then old_ts := OLD.ts; end if;
    if TG_OP <> 'DELETE' and NEW.type = 'navigation' then new_ts := NEW.ts; end if;
    if TG_OP = 'UPDATE' and (OLD.type, OLD.ts, OLD.participant_id, OLD.session_id, OLD.url, OLD.data)
      is not distinct from (NEW.type, NEW.ts, NEW.participant_id, NEW.session_id, NEW.url, NEW.data) then return null; end if;
  else
    if TG_OP <> 'INSERT' then old_ts := OLD.valid_from_ts; end if;
    if TG_OP <> 'DELETE' then new_ts := NEW.valid_from_ts; end if;
    if TG_OP = 'UPDATE' and (OLD.canonical_url, OLD.title, OLD.favicon_url, OLD.valid_from_ts)
      is not distinct from (NEW.canonical_url, NEW.title, NEW.favicon_url, NEW.valid_from_ts) then return null; end if;
  end if;
  if old_ts is null and new_ts is null then return null; end if;
  -- Lock first, then read: a concurrent chunk may advance past the arriving row.
  perform 1 from internet_map.rollup_state where singleton for update;
  update internet_map.rollup_state set invalid_since = coalesce(invalid_since, clock_timestamp())
    where singleton and least(old_ts, new_ts) < watermark;
  return null;
end $$;
create trigger internet_map_source_change after insert or update or delete on public.collection_events
  for each row execute function internet_map.invalidate_source();
create trigger internet_map_metadata_change after insert or update or delete on public.page_metadata_history
  for each row execute function internet_map.invalidate_source();

revoke all on all tables in schema internet_map from public, anon, authenticated, service_role;
revoke all on all sequences in schema internet_map from public, anon, authenticated, service_role;
revoke all on all functions in schema internet_map from public, anon, authenticated, service_role;
-- Role creation, grants, and scheduling are separate operator-approved steps.

-- CALL outside a transaction: each chunk commits independently and releases ingestion.
create procedure internet_map.refresh(max_chunks integer default 48, chunk interval default interval '1 hour')
language plpgsql as $$
declare result jsonb; cutoff timestamptz := now() - interval '1 hour';
begin
  if max_chunks is null or max_chunks < 1 or max_chunks > 10000 then raise exception 'Invalid chunk limit'; end if;
  for i in 1..max_chunks loop
    result := internet_map.rollup(cutoff, chunk);
    commit;
    exit when (result->>'caught_up')::boolean;
  end loop;
end $$;
revoke all on procedure internet_map.refresh(integer, interval) from public, anon, authenticated, service_role;
