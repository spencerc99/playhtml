-- Page metadata snapshots for deduplicated title/favicon history.
-- Apply in Supabase before enabling server-side history writes.

create table if not exists public.page_metadata_history (
  id uuid primary key default gen_random_uuid(),
  page_ref text not null,
  canonical_url text not null,
  title text not null,
  favicon_url text not null,
  metadata_hash text not null,
  valid_from_ts timestamptz not null,
  valid_to_ts timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_metadata_history_page_ref
  on public.page_metadata_history (page_ref);

create index if not exists idx_page_metadata_history_current
  on public.page_metadata_history (page_ref)
  where valid_to_ts is null;

create index if not exists idx_page_metadata_history_valid_from
  on public.page_metadata_history (valid_from_ts desc);
