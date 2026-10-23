create table public.user_analyst_forecasts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null
    references public.instrument_catalog (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  analyst_name text check (analyst_name is null or char_length(analyst_name) <= 200),
  forecast_period text check (forecast_period is null or char_length(forecast_period) <= 100),
  document_date date,
  source_url text check (source_url is null or source_url ~* '^https://'),
  storage_path text not null unique,
  original_file_name text not null
    check (char_length(original_file_name) between 1 and 255),
  mime_type text not null check (mime_type = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint user_analyst_forecasts_storage_path_check check (
    storage_path = owner_id::text || '/' || id::text || '.pdf'
  ),
  unique (owner_id, instrument_id, sha256)
);

create index user_analyst_forecasts_owner_instrument_idx
  on public.user_analyst_forecasts (owner_id, instrument_id, created_at desc);

alter table public.user_analyst_forecasts enable row level security;

revoke all on public.user_analyst_forecasts from public, anon, authenticated;
grant select on public.user_analyst_forecasts to authenticated;
grant select, insert, update, delete on public.user_analyst_forecasts to service_role;

create policy "Owners and administrators can read private analyst forecasts"
  on public.user_analyst_forecasts for select to authenticated
  using (
    (owner_id = (select auth.uid()) and (select public.has_active_access()))
    or (select public.is_admin())
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'analyst-forecasts',
  'analyst-forecasts',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners and administrators can read private forecast files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'analyst-forecasts'
    and exists (
      select 1
      from public.user_analyst_forecasts as forecast
      where forecast.storage_path = name
        and (
          (forecast.owner_id = (select auth.uid()) and (select public.has_active_access()))
          or (select public.is_admin())
        )
    )
  );
