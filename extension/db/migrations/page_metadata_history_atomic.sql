do $$
begin
  if exists (
    select 1
    from public.page_metadata_history
    where valid_to_ts is null
    group by page_ref
    having count(*) > 1
  ) then
    raise exception 'page_metadata_history has multiple current rows; resolve them before applying this migration';
  end if;
end;
$$;

drop index if exists public.idx_page_metadata_history_current;

create unique index idx_page_metadata_history_current
  on public.page_metadata_history (page_ref)
  where valid_to_ts is null;

create or replace function public.record_page_metadata_snapshot(
  p_page_ref text,
  p_canonical_url text,
  p_title text,
  p_favicon_url text,
  p_metadata_hash text,
  p_observed_at_ts timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  current_metadata_hash text;
  current_valid_from_ts timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_page_ref, 0));

  select metadata_hash, valid_from_ts
  into current_metadata_hash, current_valid_from_ts
  from public.page_metadata_history
  where page_ref = p_page_ref
    and valid_to_ts is null
  for update;

  if found and p_observed_at_ts <= current_valid_from_ts then
    return false;
  end if;

  if found and current_metadata_hash = p_metadata_hash then
    return false;
  end if;

  if found then
    update public.page_metadata_history
    set valid_to_ts = p_observed_at_ts
    where page_ref = p_page_ref
      and valid_to_ts is null;
  end if;

  insert into public.page_metadata_history (
    page_ref,
    canonical_url,
    title,
    favicon_url,
    metadata_hash,
    valid_from_ts,
    valid_to_ts
  ) values (
    p_page_ref,
    p_canonical_url,
    p_title,
    p_favicon_url,
    p_metadata_hash,
    p_observed_at_ts,
    null
  );

  return true;
end;
$$;
