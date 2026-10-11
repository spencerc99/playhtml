-- ABOUTME: Verify URL transforms, resumable sessions, retries, and invalidation locally.
-- ABOUTME: Use only synthetic browsing records and roll back every test mutation.
begin;
do $$ begin
  if exists(select from public.collection_events) or exists(select from public.page_metadata_history)
     or exists(select from internet_map.pages) then raise exception 'Tests require a fresh local db:reset'; end if;
end $$;

insert into public.collection_events (id, type, ts, participant_id, session_id, url, data) values
('map-01','navigation','2026-01-01 00:59:00Z','person-a','session-a','https://example.com/a','{}'),
('map-02','navigation','2026-01-01 01:00:00Z','person-a','session-a','https://example.net/b','{}'),
('map-03','navigation','2026-01-01 01:01:00Z','person-a','session-a','https://example.org/c','{}'),
('map-04','navigation','2026-01-01 01:02:00Z','person-a','session-a','https://example.org/c','{}'),
('map-05','navigation','2026-01-01 01:02:00Z','person-a','session-a','https://example.net/b','{}'),
('map-06','navigation','2026-01-01 01:03:00Z','person-a','session-a','https://example.com/a','{}'),
('map-07','navigation','2026-01-01 00:00:00Z','person-b','session-b','https://example.com/a','{}'),
('map-08','navigation','2026-01-01 00:31:00Z','person-b','session-b','https://example.com/a','{}'),
('map-09','navigation','2026-01-01 00:32:00Z','person-b','session-b','https://example.net/b','{}'),
('map-10','navigation','2026-01-01 00:33:00Z','person-b','session-b','https://example.org/c','{}'),
('map-11','navigation','2026-01-01 00:10:00Z','person-c','session-c','about:blank','{}'),
('map-12','scroll','2026-01-01 00:10:00Z','person-c','session-c','https://example.com/ignored','{}');
insert into public.page_metadata_history (id,page_ref,canonical_url,title,favicon_url,metadata_hash,valid_from_ts,valid_to_ts,latest_observed_at_ts) values
('00000000-0000-0000-0000-000000000001','synthetic-a','https://example.com/a','(2) A   title','https://example.com/icon.png','first','2026-01-01 00:00:00Z','2026-01-01 01:00:00Z','2026-01-01 00:00:00Z'),
('00000000-0000-0000-0000-000000000002','synthetic-a','https://example.com/a','A title','https://example.com/icon.png','second','2026-01-01 01:00:00Z',null,'2026-01-01 01:00:00Z');

-- Compare full semantic rows, independent of generated page ids and sequence gaps.
create function pg_temp.snapshot() returns jsonb language sql as $$
 select jsonb_build_object(
  'pages', (select jsonb_agg(to_jsonb(p)-'id' order by page_key) from internet_map.pages p),
  'jumps', (select jsonb_agg(jsonb_build_array(a.page_key,b.page_key,j.raw_count,
    (select count(*) from internet_map.jump_sessions s where s.a=j.a and s.b=j.b)) order by a.page_key,b.page_key)
    from internet_map.jumps j join internet_map.pages a on a.id=j.a join internet_map.pages b on b.id=j.b),
  'triples', (select jsonb_agg(jsonb_build_array(least(a.page_key,c.page_key),b.page_key,greatest(a.page_key,c.page_key),t.count)
    order by least(a.page_key,c.page_key),b.page_key,greatest(a.page_key,c.page_key))
    from internet_map.triples t join internet_map.pages a on a.id=t.a join internet_map.pages b on b.id=t.b join internet_map.pages c on c.id=t.c),
  'sessions',(select jsonb_agg(jsonb_build_array(p.page_key,s.session) order by p.page_key,s.session)
    from internet_map.page_sessions s join internet_map.pages p on p.id=s.page),
  'participants',(select jsonb_agg(jsonb_build_array(p.page_key,s.participant) order by p.page_key,s.participant)
    from internet_map.page_participants s join internet_map.pages p on p.id=s.page),
  'titles',(select jsonb_agg(to_jsonb(t) order by page_key,title) from internet_map.titles t),
  'favicons',(select jsonb_agg(to_jsonb(t) order by host,favicon) from internet_map.host_favicons t))
$$;
-- Session variables survive savepoint rollback, so retain one-shot expected results there.
savepoint before_rollup;
do $$ begin
  perform internet_map.rollup('2026-01-01 02:00:00Z', interval '1 day');
  perform set_config('internet_map.expected', pg_temp.snapshot()::text, false);
end $$;
-- Capture outside the rolled-back subtransaction using a psql variable.
select pg_temp.snapshot()::text as expected \gset
rollback to before_rollup;
do $$ begin
  perform internet_map.rollup('2026-01-01 02:00:00Z', interval '1 hour');
  perform internet_map.rollup('2026-01-01 02:00:00Z', interval '1 hour');
end $$;
select set_config('internet_map.expected', :'expected', true) as ignored \gset
do $$ begin
  assert pg_temp.snapshot() = current_setting('internet_map.expected')::jsonb, 'chunk parity';
  perform internet_map.rollup('2026-01-01 02:00:00Z');
  assert pg_temp.snapshot() = current_setting('internet_map.expected')::jsonb, 'retry idempotence';
  assert (select sum(hits) = 10 from internet_map.pages), 'accepted visits';
  assert (select rejected_events = 1 from internet_map.rollup_state), 'invalid URL accounting';
  assert (select sum(count) = 2 from internet_map.triples), 'collapsed-run timestamps';
  assert (select sum(in_page_events) = 1 from internet_map.pages), 'in-page activity gap';
  assert (select sum(raw_count) = 6 from internet_map.jumps), 'jump timestamps';
  assert (select sum(votes) = 2 from internet_map.titles), 'metadata votes';
  assert (select page_key = 'example.com/a?x=1' from internet_map.normalise('https://WWW.Example.com//a/?utm_source=synthetic&x=1#part'));
  assert (select page_key = 'google.com/search?q=hello world' from internet_map.normalise('https://google.com/search?q=Hello+World&source=test'));
  assert (select page_key = U&'google.com/search?q=i\0307' from internet_map.normalise('https://google.com/search?q=İ')), 'Unicode lowercase expansion';
  assert not internet_map.opaque('١٢٣٤٥ + ٦٧٨٩٠.'), 'Unicode digits are not letters';
  assert (select page_key = U&'i\0307.example/path' from internet_map.normalise('https://İ.example/path')), 'Expanded host preserves path';
  assert internet_map.clean_title(U&' A\00a0title\202fwith spaces ') = 'A title with spaces', 'Unicode title whitespace';
  assert internet_map.domain_of('docs.example.co.uk:443') = 'example.co.uk';
  assert internet_map.redact_url('localhost:3000/private') = 'private-network';
  assert internet_map.redact_title('private subject','mail.google.com/inbox') = '';
  assert internet_map.redact_url('example.com/a?token=abcd') = 'example.com/a?token=████';
  assert has_table_privilege('internet_map_reader','internet_map.pages','select');
  assert not has_table_privilege('internet_map_reader','public.collection_events','select');
  assert not has_table_privilege('internet_map_reader','public.page_metadata_history','select');
  assert not has_table_privilege('internet_map_reader','internet_map.pages','insert');
  assert not has_function_privilege('internet_map_reader','internet_map.rollup(timestamp with time zone,interval)','execute');
  assert not has_schema_privilege('anon','internet_map','usage');
  assert not has_function_privilege('authenticated','internet_map.rollup(timestamp with time zone,interval)','execute');
  begin
    perform internet_map.rollup(now());
    raise exception 'Future cutoff accepted';
  exception when raise_exception then
    if sqlerrm <> 'Rollup cutoff must be at least one hour old' then raise; end if;
  end;
end $$;
insert into public.collection_events (id,type,ts,participant_id,session_id,url,data)
values ('map-late','navigation','2026-01-01 00:05:00Z','late-person','late-session','https://example.com/late','{}');
do $$ begin
  assert (select invalid_since is not null from internet_map.rollup_state), 'late event invalidation';
  begin
    perform internet_map.rollup('2026-01-01 03:00:00Z');
    raise exception 'Invalid snapshot accepted';
  exception when raise_exception then
    if sqlerrm <> 'Rollup invalidated by source changes; rebuild required' then raise; end if;
  end;
end $$;
rollback;
