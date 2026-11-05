-- ABOUTME: Schedule committed navigation rollup chunks after explicit operator approval.
-- ABOUTME: Require pg_cron to be enabled separately and run only as the database owner.
do $$ begin
  if not exists(select from pg_extension where extname = 'pg_cron') then
    raise exception 'Enable pg_cron before scheduling internet-map rollups';
  end if;
end $$;
select cron.schedule('internet-map-rollup', '0 3 * * *',
  $$call internet_map.refresh(48, interval '1 hour')$$);
